import './styles.css';
import { TIMER_GLYPHS } from './timer-glyphs';

const BUILD_ID = 'appdeploy-v77-github-pages-v1';
const SW_CACHE_VERSION = 'checkin-timer-cache-v1-appdeploy-v77';
const VIDEO_ASSET_VERSION = 'background-clean-v2-v77';
const STAGE_W = 1222;
const STAGE_H = 2688;
const PRIMARY_STORAGE_KEY = 'checkinStartEpochMs';
const COMPAT_STORAGE_KEY = 'checkin-timer-start-v1';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HIT_PAD_X = 4;
const HIT_PAD_Y = 8;
const CENTER_CURVE: number[] = [0, -1, 1, 0, -1, -2, -1, 1, -1, -1, -1, -1, 1, 1, -1, -2, 1, -1, -1, -2, -1, -1, 1, 0, -1, -1, 1, -1, -1, -1, -1, -1, -1, -1, 0, -1, 0, 0, -1, -1, -1, -1, 2, 0, -1, -2, -1, 0, -1, -2, -1, -1];

type View = 'timer' | 'map' | 'profile' | 'checkins';
type QaState = { month: string; day: number; hour: number; minute: number; elapsedAtLoad: number; };
type HoldState = 'IDLE' | 'HOLDING' | 'FIRED';
type TimerGlyph = { width: number; height: number; data: readonly number[]; };

const stage = document.getElementById('stage') as HTMLDivElement;
const timerView = document.getElementById('timerView') as HTMLElement;
const mapView = document.getElementById('mapView') as HTMLElement;
const profileView = document.getElementById('profileView') as HTMLElement;
const checkinsView = document.getElementById('checkinsView') as HTMLElement;
const video = document.getElementById('backgroundVideo') as HTMLVideoElement;
const profilePhotoVideo = document.getElementById('profilePhotoVideo') as HTMLVideoElement | null;
const dynamicCheckin = document.getElementById('dynamicCheckin') as HTMLDivElement;
const startDateEl = document.getElementById('startDate') as HTMLSpanElement;
const startTimeEl = document.getElementById('startTime') as HTMLSpanElement;
const profileDynamicPlanDate = document.getElementById('profileDynamicPlanDate') as HTMLSpanElement | null;
const elapsedEl = document.getElementById('elapsed') as HTMLSpanElement;
const elapsedRaster = document.getElementById('elapsedRaster') as HTMLCanvasElement;
const diagnostics = document.getElementById('diagnostics') as HTMLPreElement;
const profileTimerSummary = document.getElementById('profileTimerSummary') as HTMLElement;
const checkinsTimerSummary = document.getElementById('checkinsTimerSummary') as HTMLElement;
const activeCheckinCard = document.getElementById('activeCheckinCard') as HTMLButtonElement;
const params = new URLSearchParams(window.location.search);
const diagnosticMode = params.get('diag') === '1';
const noActiveRequested = params.get('noActive') === '1';
const configuredClockMs = diagnosticMode && params.has('clockMs') ? Number(params.get('clockMs')) : NaN;
const wallClockAtLoadMs = Date.now();
document.body.dataset.diag = diagnosticMode ? 'true' : 'false';

function nowMs(): number {
  return Number.isFinite(configuredClockMs) ? configuredClockMs + (Date.now() - wallClockAtLoadMs) : Date.now();
}

function readQaState(): QaState | null {
  if (params.get('qa') !== '1') return null;
  const monthParam = params.get('month') || 'Sep';
  const month = MONTHS.includes(monthParam) ? monthParam : 'Sep';
  const day = Math.min(31, Math.max(1, Number(params.get('day') || 7)));
  const hour = Math.min(23, Math.max(0, Number(params.get('hour') || 10)));
  const minute = Math.min(59, Math.max(0, Number(params.get('minute') || 20)));
  const elapsedAtLoad = Math.min(86400 * 7, Math.max(0, Number(params.get('seconds') || 55)));
  return { month, day, hour, minute, elapsedAtLoad };
}

const qaState = readQaState();
let qaElapsedBaseMs = qaState && !noActiveRequested ? nowMs() - qaState.elapsedAtLoad * 1000 : 0;
let startMs = qaState ? 0 : (noActiveRequested ? 0 : readOrCreateStart());
let currentView: View = readHashView();
let holdTimer: number | null = null;
let activePointerId: number | null = null;
let holdStartedAt = 0;
let lastPointerX = 0;
let lastPointerY = 0;
let lastOldStartMs = 0;
let lastNewStartMs = 0;
let holdState: HoldState = 'IDLE';
let resetCount = 0;
let actionLock = false;
let navigationCount = 0;
let lastNavigationAction = 'INITIAL';
let lastStartNewCheckinSource = 'NONE';
let startNewCheckinCallCount = 0;
let lastDiagnosticUpdateAt = 0;
let timerLoopActive = false;
let motionLoopActive = false;
let lastRenderedSecond = -1;
let wakeLock: WakeLockSentinel | null = null;

function readHashView(): View {
  const value = window.location.hash.replace('#', '');
  return value === 'map' || value === 'profile' || value === 'checkins' ? value : 'timer';
}

function currentStartMs(): number {
  return qaState ? qaElapsedBaseMs : startMs;
}

function readOrCreateStart(): number {
  const primary = Number(localStorage.getItem(PRIMARY_STORAGE_KEY));
  if (Number.isFinite(primary) && primary > 0) {
    if (localStorage.getItem(COMPAT_STORAGE_KEY) !== String(primary)) localStorage.setItem(COMPAT_STORAGE_KEY, String(primary));
    return primary;
  }
  const compatible = Number(localStorage.getItem(COMPAT_STORAGE_KEY));
  if (Number.isFinite(compatible) && compatible > 0) {
    localStorage.setItem(PRIMARY_STORAGE_KEY, String(compatible));
    return compatible;
  }
  const value = nowMs();
  persistStart(value);
  return value;
}

function persistStart(value: number): void {
  localStorage.setItem(PRIMARY_STORAGE_KEY, String(value));
  localStorage.setItem(COMPAT_STORAGE_KEY, String(value));
}

function pad2(value: number): string { return String(value).padStart(2, '0'); }

function renderStart(): void {
  if (!currentStartMs()) {
    startDateEl.textContent = 'Kein';
    startTimeEl.textContent = 'aktiver Check-in';
    return;
  }
  if (qaState) {
    startDateEl.textContent = qaState.month + ' ' + qaState.day + ',';
    startTimeEl.textContent = pad2(qaState.hour) + ':' + pad2(qaState.minute);
    return;
  }
  const date = new Date(startMs);
  startDateEl.textContent = MONTHS[date.getMonth()] + ' ' + date.getDate() + ',';
  startTimeEl.textContent = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function elapsedSeconds(): number {
  const activeStart = currentStartMs();
  return activeStart > 0 ? Math.max(0, Math.floor((nowMs() - activeStart) / 1000)) : 0;
}

function renderProfilePlanDate(): void {
  if (!profileDynamicPlanDate) return;
  const referenceDate = qaState ? new Date(new Date().getFullYear(), MONTHS.indexOf(qaState.month), qaState.day) : new Date(nowMs());
  profileDynamicPlanDate.textContent = WEEKDAYS[referenceDate.getDay()] + ', ' + MONTHS[referenceDate.getMonth()] + ' ' + referenceDate.getDate() + ' - 00:00-23:59';
}

function renderElapsed(force = false): void {
  const secondsTotal = elapsedSeconds();
  if (!force && secondsTotal === lastRenderedSecond) return;
  lastRenderedSecond = secondsTotal;
  const hours = Math.floor(secondsTotal / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;
  const timerText = pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds);
  elapsedEl.replaceChildren(...Array.from(timerText).map((character) => {
    const span = document.createElement('span');
    const digit = /^\\d$/.test(character);
    span.className = digit ? 'timerChar timerDigit' : 'timerChar timerPunctuation';
    if (digit) span.dataset.digit = character;
    span.textContent = character;
    return span;
  }));
  const summary = 'Seit ' + startDateEl.textContent + ' ' + startTimeEl.textContent + ' · ' + timerText;
  profileTimerSummary.textContent = summary;
  checkinsTimerSummary.textContent = summary;
  refreshActiveCheckinUi();
}

function refreshActiveCheckinUi(): void {
  const active = currentStartMs() > 0;
  activeCheckinCard.hidden = !active;
  const noActive = document.getElementById('noActiveCheckin');
  if (noActive) noActive.toggleAttribute('hidden', active);
}

function glyphInkOrigin(glyph: TimerGlyph): { left: number; top: number } {
  let left = glyph.width;
  let top = glyph.height;
  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      if (glyph.data[y * glyph.width + x] >= 4) {
        left = Math.min(left, x);
        top = Math.min(top, y);
      }
    }
  }
  return { left: left === glyph.width ? 0 : left, top: top === glyph.height ? 0 : top };
}

function renderElapsedRaster(): void {
  if (currentView !== 'timer') return;
  const lineRect = dynamicCheckin.getBoundingClientRect();
  const elapsedRect = elapsedEl.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const stageScale = stageRect.width / STAGE_W;
  if (!(stageScale > 0)) return;
  const width = Math.max(1, elapsedRect.width / stageScale + 40);
  const height = 66;
  const rasterDpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  elapsedRaster.style.left = ((elapsedRect.left - lineRect.left) / stageScale).toFixed(3) + 'px';
  elapsedRaster.style.top = ((elapsedRect.top - lineRect.top) / stageScale).toFixed(3) + 'px';
  elapsedRaster.style.width = width.toFixed(3) + 'px';
  elapsedRaster.style.height = height + 'px';
  elapsedRaster.width = Math.max(1, Math.ceil(width * rasterDpr));
  elapsedRaster.height = Math.ceil(height * rasterDpr);
  const context = elapsedRaster.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, elapsedRaster.width, elapsedRaster.height);
  for (const charEl of Array.from(elapsedEl.querySelectorAll('.timerChar'))) {
    const value = charEl.textContent || '';
    const isDigit = value >= '0' && value <= '9';
    const glyph: TimerGlyph = isDigit ? TIMER_GLYPHS.glyphs[value as keyof typeof TIMER_GLYPHS.glyphs] : TIMER_GLYPHS.colon;
    const charRect = charEl.getBoundingClientRect();
    const charLeft = (charRect.left - elapsedRect.left) / stageScale;
    const origin = glyphInkOrigin(glyph);
    const imageWidth = Math.ceil(glyph.width * rasterDpr);
    const imageHeight = Math.ceil(glyph.height * rasterDpr);
    const image = new ImageData(imageWidth, imageHeight);
    for (let y = 0; y < glyph.height; y += 1) {
      for (let x = 0; x < glyph.width; x += 1) {
        const alpha = glyph.data[y * glyph.width + x] * 17;
        if (!alpha) continue;
        const x0 = Math.floor(x * rasterDpr);
        const x1 = Math.ceil((x + 1) * rasterDpr);
        const y0 = Math.floor(y * rasterDpr);
        const y1 = Math.ceil((y + 1) * rasterDpr);
        for (let py = y0; py < y1; py += 1) {
          for (let px = x0; px < x1; px += 1) {
            const offset = (py * imageWidth + px) * 4;
            image.data[offset] = 189;
            image.data[offset + 1] = 214;
            image.data[offset + 2] = 211;
            image.data[offset + 3] = alpha;
          }
        }
      }
    }
    const drawX = Math.round((charLeft - origin.left) * rasterDpr);
    const drawY = Math.round(((elapsedRect.top - lineRect.top) / stageScale + 2 - origin.top) * rasterDpr);
    context.putImageData(image, drawX, drawY);
  }
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function startNewCheckin(now = nowMs(), source = 'unknown'): void {
  lastOldStartMs = currentStartMs();
  lastNewStartMs = now;
  startNewCheckinCallCount += 1;
  lastStartNewCheckinSource = source;
  if (qaState) {
    qaElapsedBaseMs = now;
  } else {
    startMs = now;
    persistStart(now);
  }
  renderStart();
  lastRenderedSecond = -1;
  renderElapsed(true);
}

function ensureCurrentDay(now = nowMs()): void {
  if (!qaState && startMs > 0 && localDayKey(startMs) !== localDayKey(now)) startNewCheckin(now, 'daily-reset');
}

function resetStateVerified(): boolean {
  if (elapsedEl.textContent !== '00:00:00') return false;
  if (qaState) return true;
  const date = new Date(startMs);
  return localStorage.getItem(PRIMARY_STORAGE_KEY) === String(startMs) &&
    localStorage.getItem(COMPAT_STORAGE_KEY) === String(startMs) &&
    startDateEl.textContent === MONTHS[date.getMonth()] + ' ' + date.getDate() + ',' &&
    startTimeEl.textContent === pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function resetCheckin(): void {
  startNewCheckin(nowMs(), 'long-press');
  if (!resetStateVerified()) return;
  resetCount += 1;
  if ('vibrate' in navigator) navigator.vibrate(35);
  updateDiagnostics('reset verified');
}

function setView(view: View, updateHistory = true): void {
  if (currentView === view && document.body.dataset.view === view) return;
  currentView = view;
  navigationCount += 1;
  document.body.dataset.view = view;
  fitStage();
  for (const [element, active] of [[timerView, view === 'timer'], [mapView, view === 'map'], [profileView, view === 'profile'], [checkinsView, view === 'checkins']] as const) {
    element.classList.toggle('viewHidden', !active);
    element.setAttribute('aria-hidden', active ? 'false' : 'true');
  }
  if (updateHistory && readHashView() !== view) window.location.hash = view;
  if (view === 'timer') {
    renderStart();
    renderElapsed(true);
    ensureVideoPlaying();
  }
  updateDiagnostics('view=' + view);
}

function navigate(view: View, action = 'OTHER'): void {
  if (actionLock) return;
  lastNavigationAction = action;
  setView(view);
}

function startNewCheckinFromMap(): void {
  if (actionLock) return;
  actionLock = true;
  lastNavigationAction = 'QR';
  startNewCheckin(nowMs(), 'qr');
  setView('timer');
  window.setTimeout(() => { actionLock = false; }, 350);
}

function hitRect(): DOMRect {
  const rect = dynamicCheckin.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const scaleX = stageRect.width / STAGE_W;
  const scaleY = stageRect.height / STAGE_H;
  const padX = HIT_PAD_X * (Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1);
  const padY = HIT_PAD_Y * (Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1);
  return new DOMRect(rect.left - padX, rect.top - padY, rect.width + padX * 2, rect.height + padY * 2);
}

function releasePointer(pointerId: number): void {
  if (dynamicCheckin.hasPointerCapture(pointerId)) {
    try { dynamicCheckin.releasePointerCapture(pointerId); } catch (_) {}
  }
}

function clearHold(): void {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function updateDiagnostics(message = ''): void {
  if (!diagnosticMode) return;
  const diagnosticNow = Date.now();
  if (!message && diagnosticNow - lastDiagnosticUpdateAt < 250) return;
  lastDiagnosticUpdateAt = diagnosticNow;
  const rect = dynamicCheckin.getBoundingClientRect();
  const hit = hitRect();
  diagnostics.textContent = [
    'build=' + BUILD_ID + ' cache=' + SW_CACHE_VERSION + ' video=' + VIDEO_ASSET_VERSION + ' view=' + currentView + ' clock=' + (Number.isFinite(configuredClockMs) ? 'controlled' : 'real'),
    'currentView=' + currentView + ' timerActive=' + String(currentStartMs() > 0) + ' currentStartMs=' + String(currentStartMs()),
    'lastNavigationAction=' + lastNavigationAction + ' lastStartNewCheckinSource=' + lastStartNewCheckinSource + ' startNewCheckinCallCount=' + String(startNewCheckinCallCount),
    'pointerTarget=dynamicCheckin id=' + (activePointerId === null ? 'none' : String(activePointerId)) + ' x=' + lastPointerX.toFixed(1) + ' y=' + lastPointerY.toFixed(1) + ' hold=' + holdState + ' holdStartMs=' + String(holdStartedAt) + ' elapsed=' + (holdStartedAt ? String(Math.max(0, nowMs() - holdStartedAt)) : '0') + 'ms',
    'resetFired=' + String(resetCount) + ' oldStartMs=' + String(lastOldStartMs) + ' newStartMs=' + String(lastNewStartMs),
    'primaryStorage=' + (qaState ? 'QA-isolated' : String(localStorage.getItem(PRIMARY_STORAGE_KEY))) + ' compatStorage=' + (qaState ? 'QA-isolated' : String(localStorage.getItem(COMPAT_STORAGE_KEY))),
    'visibleDate=' + String(startDateEl.textContent) + ' visibleTime=' + String(startTimeEl.textContent) + ' visibleTimer=' + String(elapsedEl.textContent),
    'textBounds=' + [rect.x.toFixed(1), rect.y.toFixed(1), rect.width.toFixed(1), rect.height.toFixed(1)].join(','),
    'hitBounds=' + [hit.x.toFixed(1), hit.y.toFixed(1), hit.width.toFixed(1), hit.height.toFixed(1)].join(','),
    'navigationCount=' + String(navigationCount),
    message
  ].join('\n');
}

function fireHold(): void {
  if (holdState !== 'HOLDING' || activePointerId === null) return;
  clearHold();
  holdState = 'FIRED';
  resetCheckin();
  updateDiagnostics('hold fired');
}

function beginHold(event: PointerEvent): void {
  if (activePointerId !== null || currentView !== 'timer') return;
  event.preventDefault();
  activePointerId = event.pointerId;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  holdStartedAt = nowMs();
  holdState = 'HOLDING';
  clearHold();
  try { dynamicCheckin.setPointerCapture(event.pointerId); } catch (_) {}
  holdTimer = window.setTimeout(fireHold, 3000);
  updateDiagnostics('hold started');
}

function endHold(event: PointerEvent, cancelled: boolean): void {
  if (activePointerId !== event.pointerId) return;
  event.preventDefault();
  clearHold();
  releasePointer(event.pointerId);
  activePointerId = null;
  holdStartedAt = 0;
  holdState = 'IDLE';
  updateDiagnostics(cancelled ? 'hold cancelled' : 'hold ended');
}

function timerLoop(): void {
  if (timerLoopActive) return;
  timerLoopActive = true;
  const tick = (): void => {
    ensureCurrentDay();
    renderElapsed(false);
    renderProfilePlanDate();
    renderElapsedRaster();
    updateDiagnostics();
    window.setTimeout(tick, 200);
  };
  tick();
}

function motionLoop(): void {
  if (motionLoopActive) return;
  motionLoopActive = true;
  const frame = (): void => {
    const time = Number.isFinite(video.currentTime) ? ((video.currentTime % CENTER_CURVE.length) + CENTER_CURVE.length) % CENTER_CURVE.length : 0;
    const index = Math.min(CENTER_CURVE.length - 1, Math.floor(time));
    const next = (index + 1) % CENTER_CURVE.length;
    const fraction = Math.max(0, Math.min(1, time - index));
    const centerOffset = CENTER_CURVE[index] + (CENTER_CURVE[next] - CENTER_CURVE[index]) * fraction;
    dynamicCheckin.style.transform = 'translateX(calc(-50% + ' + centerOffset.toFixed(3) + 'px))';
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

function playVideo(target: HTMLVideoElement): void {
  target.muted = true;
  const attempt = target.play();
  if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
}

function ensureVideoPlaying(): void {
  playVideo(video);
  if (profilePhotoVideo) {
    if (profilePhotoVideo.readyState < 2) profilePhotoVideo.load();
    if (profilePhotoVideo.readyState >= 1) profilePhotoVideo.currentTime = video.currentTime;
    playVideo(profilePhotoVideo);
  }
}

async function requestWakeLock(): Promise<void> {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (_) {}
}

function wireNavigation(): void {
  document.getElementById('timerExit')?.addEventListener('click', () => navigate('map', 'X'));
  document.getElementById('mapExit')?.addEventListener('click', () => navigate('timer'));
  document.getElementById('profileExit')?.addEventListener('click', () => navigate('map'));
  document.getElementById('mapStartNav')?.addEventListener('click', () => navigate('timer'));
  document.getElementById('mapLocationNav')?.addEventListener('click', () => navigate('map'));
  document.getElementById('mapCoursesNav')?.addEventListener('click', () => navigate('map'));
  document.getElementById('mapQrButton')?.addEventListener('click', startNewCheckinFromMap);
  document.getElementById('mapQuickQrButton')?.addEventListener('click', startNewCheckinFromMap);
  document.getElementById('mapProfileButton')?.addEventListener('click', () => navigate('profile', 'PROFILE'));
  document.getElementById('profileStartNav')?.addEventListener('click', () => navigate('timer'));
  document.getElementById('profileLocationNav')?.addEventListener('click', () => navigate('map'));
  document.getElementById('profileCoursesNav')?.addEventListener('click', () => navigate('profile'));
  document.getElementById('profileCheckinNav')?.addEventListener('click', () => navigate('map'));
  document.getElementById('profileProfileNav')?.addEventListener('click', () => navigate('profile'));
  document.getElementById('profileCheckins')?.addEventListener('click', () => navigate('checkins', 'CHECK_INS'));
  document.getElementById('checkinsBack')?.addEventListener('click', () => navigate('timer', 'BACK'));
  document.getElementById('activeCheckinCard')?.addEventListener('click', () => navigate('timer', 'ACTIVE_CHECKIN'));
  document.getElementById('checkinsStartNav')?.addEventListener('click', () => navigate('timer'));
  document.getElementById('checkinsLocationNav')?.addEventListener('click', () => navigate('map'));
  document.getElementById('checkinsCoursesNav')?.addEventListener('click', () => navigate('checkins'));
  document.getElementById('checkinsCheckinNav')?.addEventListener('click', () => navigate('map'));
  document.getElementById('checkinsProfileNav')?.addEventListener('click', () => navigate('profile'));
  window.addEventListener('hashchange', () => setView(readHashView(), false));
}

dynamicCheckin.addEventListener('pointerdown', beginHold, { passive: false });
dynamicCheckin.addEventListener('pointermove', (event) => {
  if (activePointerId === event.pointerId) {
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    const hit = hitRect();
    const insideHit = event.clientX >= hit.left && event.clientX <= hit.right && event.clientY >= hit.top && event.clientY <= hit.bottom;
    if (!insideHit) {
      endHold(event, true);
      return;
    }
    updateDiagnostics('pointer moved');
  }
}, { passive: false });
dynamicCheckin.addEventListener('pointerleave', (event) => {
  if (activePointerId === event.pointerId && !dynamicCheckin.hasPointerCapture(event.pointerId)) endHold(event, true);
}, { passive: false });
dynamicCheckin.addEventListener('pointerup', (event) => endHold(event, false), { passive: false });
dynamicCheckin.addEventListener('pointercancel', (event) => endHold(event, true), { passive: false });
dynamicCheckin.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('resize', () => { fitStage(); updateDiagnostics(); }, { passive: true });
window.addEventListener('orientationchange', () => { fitStage(); updateDiagnostics(); }, { passive: true });
window.addEventListener('pointerdown', ensureVideoPlaying, { passive: true, once: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    ensureCurrentDay();
    ensureVideoPlaying();
    renderStart();
    renderElapsed(true);
    void requestWakeLock();
  }
});
window.addEventListener('pageshow', () => {
  ensureCurrentDay();
  renderStart();
  renderElapsed(true);
  ensureVideoPlaying();
});
video.addEventListener('loadeddata', () => ensureVideoPlaying(), { once: true });
profilePhotoVideo?.addEventListener('loadeddata', () => ensureVideoPlaying(), { once: true });
video.addEventListener('pause', () => {
  if (document.visibilityState === 'visible') window.setTimeout(ensureVideoPlaying, 100);
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw-v2.js?build=' + BUILD_ID, { updateViaCache: 'none' }).then((registration) => registration.update()).catch(() => {});
  });
}

function fitStage(): void {
  const scale = currentView === 'timer' ? Math.max(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H) : Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  stage.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
}

wireNavigation();
fitStage();
setView(currentView, false);
ensureCurrentDay();
renderStart();
renderElapsed(true);
timerLoop();
ensureVideoPlaying();
motionLoop();
updateDiagnostics('ready');
