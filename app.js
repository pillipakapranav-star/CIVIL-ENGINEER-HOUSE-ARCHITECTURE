/* ═══════════════════════════════════════════════════════════
   ArchVision Pro — app.js
   Professional Civil Engineering 3D Design Application
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
const State = {
  project: null,
  currentFloor: 0,
  currentTool: 'select',
  viewMode: '3d',
  selectedObject: null,
  objects: [],         // { id, type, floor, mesh, data }
  rooms: [],           // { id, name, floor, color, area, bounds }
  lights: [],
  history: [],         // undo stack
  future: [],          // redo stack
  snapEnabled: true,
  gridVisible: true,
  shadowsEnabled: true,
  wireframe: false,
  renderMode: false,
  dirty: false,
  measurePoints: [],
  libCategory: 'all',
  layers: {
    walls: { visible: true, color: '#6495ed' },
    columns: { visible: true, color: '#f59e0b' },
    slabs: { visible: true, color: '#8b5cf6' },
    doors: { visible: true, color: '#22c55e' },
    windows: { visible: true, color: '#06b6d4' },
    stairs: { visible: true, color: '#f97316' },
    roofs: { visible: true, color: '#ef4444' },
    furniture: { visible: true, color: '#ec4899' },
    lights: { visible: true, color: '#fbbf24' },
    rooms: { visible: true, color: '#4ade80' },
  }
};

let idCounter = 1;
function uid() { return 'obj_' + (idCounter++) + '_' + Math.floor(Math.random() * 9999); }

// ═══════════════════════════════════════════════
// THREE.JS SCENE
// ═══════════════════════════════════════════════
let scene, camera, renderer, controls;
let gridHelper, groundPlane;
let animFrameId;
let raycaster, mouse;
let isPlacing = false;
let placementPreview = null;
let orbitDragging = false;
let lastOrbitMouse = null;
let cameraTheta = Math.PI / 4, cameraPhi = Math.PI / 3.5, cameraRadius = 30;
let cameraTarget = new THREE.Vector3(0, 0, 0);

function initScene() {
  const canvas = document.getElementById('three-canvas');
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setClearColor(0x0a0e16);

  // Scene
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0e16, 0.012);

  // Camera
  camera = new THREE.PerspectiveCamera(55, w / h, 0.05, 500);
  updateCameraFromSpherical();

  // Raycaster
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Ambient
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  // Sun / Hemisphere
  const hemi = new THREE.HemisphereLight(0xddeeff, 0x222244, 0.4);
  scene.add(hemi);

  // Dir light
  const dirLight = new THREE.DirectionalLight(0xfff8e7, 1.2);
  dirLight.position.set(20, 40, 20);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 200;
  dirLight.shadow.camera.left = -40;
  dirLight.shadow.camera.right = 40;
  dirLight.shadow.camera.top = 40;
  dirLight.shadow.camera.bottom = -40;
  dirLight.shadow.bias = -0.001;
  scene.add(dirLight);

  // Grid
  gridHelper = new THREE.GridHelper(100, 200, 0x1c2330, 0x1c2330);
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.6;
  scene.add(gridHelper);

  // Ground
  const geoGround = new THREE.PlaneGeometry(200, 200);
  const matGround = new THREE.MeshStandardMaterial({ color: 0x0f1520, roughness: 1, metalness: 0 });
  groundPlane = new THREE.Mesh(geoGround, matGround);
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.receiveShadow = true;
  groundPlane.name = 'ground';
  scene.add(groundPlane);

  // Plot outline
  drawPlotOutline();

  // Events
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);

  // Start render loop
  renderLoop();
}

function updateCameraFromSpherical() {
  const x = cameraRadius * Math.sin(cameraPhi) * Math.sin(cameraTheta);
  const y = cameraRadius * Math.cos(cameraPhi);
  const z = cameraRadius * Math.sin(cameraPhi) * Math.cos(cameraTheta);
  camera.position.set(
    cameraTarget.x + x,
    cameraTarget.y + y,
    cameraTarget.z + z
  );
  camera.lookAt(cameraTarget);
}

function renderLoop() {
  animFrameId = requestAnimationFrame(renderLoop);
  if (State.viewMode === '3d') {
    renderer.render(scene, camera);
  }
}

function onResize() {
  const ws = document.getElementById('workspace');
  const w = ws.clientWidth, h = ws.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (State.viewMode === '2d') renderPlan2D();
}

// ───────────────────────────────────────────────
// CAMERA CONTROLS (custom orbit/pan/zoom)
// ───────────────────────────────────────────────
let mouseBtn = -1;
let lastMX = 0, lastMY = 0;
let isPanning = false;

function onMouseDown(e) {
  mouseBtn = e.button;
  lastMX = e.clientX; lastMY = e.clientY;

  if (e.button === 1 || (e.button === 0 && State.currentTool === 'pan')) {
    isPanning = true; return;
  }
  if (e.button === 2 || (e.button === 0 && State.currentTool === 'orbit')) {
    orbitDragging = true; return;
  }
  if (e.button === 0) handleToolClick(e);
}

function onMouseMove(e) {
  const dx = e.clientX - lastMX;
  const dy = e.clientY - lastMY;
  lastMX = e.clientX; lastMY = e.clientY;

  // Coords in status bar
  const ws = document.getElementById('workspace');
  const rect = ws.getBoundingClientRect();
  const wx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const wy = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const worldPt = screenToWorld(wx, wy);
  if (worldPt) {
    document.getElementById('sb-coords').textContent =
      `X: ${worldPt.x.toFixed(2)}  Y: ${worldPt.y.toFixed(2)}  Z: ${worldPt.z.toFixed(2)}`;
  }

  if (orbitDragging) {
    cameraTheta -= dx * 0.008;
    cameraPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, cameraPhi + dy * 0.008));
    updateCameraFromSpherical();
    return;
  }
  if (isPanning) {
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    right.crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
    up.copy(camera.up);
    const spd = cameraRadius * 0.003;
    cameraTarget.addScaledVector(right, -dx * spd);
    cameraTarget.addScaledVector(up, dy * spd);
    updateCameraFromSpherical();
    return;
  }

  handleToolHover(e);
}

function onMouseUp(e) {
  orbitDragging = false;
  isPanning = false;
  mouseBtn = -1;
}

function onWheel(e) {
  e.preventDefault();
  cameraRadius = Math.max(2, Math.min(150, cameraRadius + e.deltaY * 0.04));
  updateCameraFromSpherical();
}

function screenToWorld(nx, ny, yPlane) {
  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  if (yPlane !== undefined) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -yPlane);
    const pt = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, pt);
    return pt;
  }
  const objects = [groundPlane];
  const hits = raycaster.intersectObjects(objects);
  return hits.length ? hits[0].point : null;
}

function getMouseWorld(e, elevation) {
  const ws = document.getElementById('workspace');
  const rect = ws.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const y = elevation !== undefined ? elevation : getCurrentFloorElevation();
  return screenToWorld(nx, ny, y);
}

function snap(val, grid = 0.5) {
  if (!State.snapEnabled) return val;
  return Math.round(val / grid) * grid;
}

function getCurrentFloorElevation() {
  if (!State.project) return 0;
  return State.currentFloor * State.project.floorHeight;
}

// ═══════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════
function onKeyDown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  const key = e.key.toLowerCase();

  if (e.ctrlKey || e.metaKey) {
    if (key === 'z') { e.preventDefault(); undoAction(); return; }
    if (key === 'y') { e.preventDefault(); redoAction(); return; }
    if (key === 's') { e.preventDefault(); saveProject(); return; }
    if (key === 'd') { e.preventDefault(); duplicateSelected(); return; }
  }

  // Tool shortcuts
  const toolMap = { 'v': 'select', 'm': 'measure', 'o': 'orbit', 'h': 'pan',
    'w': 'wall', 'p': 'partition', 'c': 'column', 'd': 'door', 'n': 'window',
    'r': 'room', 's': 'stair', 'l': 'light' };
  if (toolMap[key] && !e.ctrlKey) setTool(toolMap[key]);

  if (key === 'escape') { cancelPlacement(); clearSelection(); }
  if (key === 'delete' || key === 'backspace') deleteSelected();
  if (key === 'g') toggleGrid();
  if (key === 'f') fitView();
}

// ═══════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════
let wallStart = null;
let wallPreviewMesh = null;

function setTool(name) {
  State.currentTool = name;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-tool="${name}"]`);
  if (btn) btn.classList.add('active');
  document.getElementById('active-tool-badge').textContent = name.charAt(0).toUpperCase() + name.slice(1);

  // Show measure HUD
  const mhud = document.getElementById('measure-hud');
  if (name === 'measure') {
    mhud.style.display = 'block';
    document.getElementById('measure-text').textContent = 'Click to set start point';
    State.measurePoints = [];
  } else {
    mhud.style.display = 'none';
    State.measurePoints = [];
    removeMeasureHelpers();
  }

  const hints = {
    select: 'Click to select, drag to move. Del to delete.',
    wall: 'Click start point, then end point to draw wall. Press Esc to cancel.',
    partition: 'Click start point, then end point to draw partition.',
    column: 'Click to place a column/pillar.',
    beam: 'Click two column endpoints to place a beam.',
    slab: 'Click corners to define a slab area. Double-click to finish.',
    door: 'Click on a wall to insert a door.',
    window: 'Click on a wall to insert a window.',
    stair: 'Click to place a staircase block.',
    room: 'Click to define a room area (drag to size).',
    light: 'Click ceiling position to place a light fixture.',
    fan: 'Click ceiling position to place a fan.',
    roof: 'Click to place roof element.',
    balcony: 'Click to place a balcony/terrace.',
    railing: 'Click start and end points for railing.',
    measure: 'Click two points to measure distance.',
    orbit: 'Drag to orbit. Right-click also orbits.',
    pan: 'Drag to pan the viewport.',
    foundation: 'Click to place footing/foundation block.',
    lintel: 'Click above a door/window to place a lintel.',
    ramp: 'Click start and end points for a ramp.',
    'false-ceiling': 'Click to place false ceiling panel.',
  };
  document.getElementById('sb-hint').textContent = hints[name] || 'Select a tool.';

  cancelPlacement();
}

function handleToolClick(e) {
  if (!State.project) { showToast('Create or open a project first.', 'error'); return; }

  const pt = getMouseWorld(e);
  if (!pt) return;

  const sx = snap(pt.x), sz = snap(pt.z);
  const elev = getCurrentFloorElevation();

  switch (State.currentTool) {
    case 'select': doSelect(e); break;
    case 'wall': doWallClick(sx, sz, elev); break;
    case 'partition': doWallClick(sx, sz, elev, 0.1, 0xb0b0b0, 'partition'); break;
    case 'column': placeColumn(sx, sz, elev); break;
    case 'beam': doBeamClick(sx, sz, elev); break;
    case 'slab': doSlabClick(sx, sz, elev); break;
    case 'door': placeDoorWindow(sx, sz, elev, 'door'); break;
    case 'window': placeDoorWindow(sx, sz, elev, 'window'); break;
    case 'lintel': placeLintel(sx, sz, elev); break;
    case 'stair': placeStair(sx, sz, elev); break;
    case 'ramp': doRampClick(sx, sz, elev); break;
    case 'railing': doRailingClick(sx, sz, elev); break;
    case 'room': doRoomClick(sx, sz, elev); break;
    case 'light': placeLight(sx, sz, elev); break;
    case 'fan': placeFan(sx, sz, elev); break;
    case 'roof': placeRoof(sx, sz, elev); break;
    case 'balcony': placeBalcony(sx, sz, elev); break;
    case 'foundation': placeFoundation(sx, sz, elev); break;
    case 'measure': doMeasure(sx, sz, elev); break;
    case 'false-ceiling': placeFalseCeiling(sx, sz, elev); break;
    default: break;
  }
}

function handleToolHover(e) {
  if (!State.project) return;
  const pt = getMouseWorld(e);
  if (!pt) return;
  const sx = snap(pt.x), sz = snap(pt.z), elev = getCurrentFloorElevation();

  if (State.currentTool === 'wall' && wallStart) {
    updateWallPreview(wallStart.x, wallStart.z, sx, sz, elev, wallStart.thickness);
  }
  if (State.currentTool === 'measure' && State.measurePoints.length === 1) {
    updateMeasurePreview(State.measurePoints[0], { x: sx, y: elev, z: sz });
  }
}

// ─── WALL PLACEMENT ───────────────────────────
let wallPreviewLine = null;
let beamStart = null;
let rampStart = null;
let railingStart = null;
let roomDragStart = null;
let slabPoints = [];
let beamPreview = null;
let measureLine = null;

function doWallClick(x, z, elev, thickness, color, type) {
  const t = thickness || (State.project ? State.project.wallThickness : 0.23);
  const c = color || 0xd4c5a9;
  const tp = type || 'wall';

  if (!wallStart) {
    wallStart = { x, z, elev, thickness: t };
    showToast('Wall start set. Click end point.', '');
  } else {
    const length = Math.sqrt((x - wallStart.x) ** 2 + (z - wallStart.z) ** 2);
    if (length < 0.2) { wallStart = null; removeWallPreview(); return; }
    placeWall(wallStart.x, wallStart.z, x, z, elev, t, c, tp);
    wallStart = null;
    removeWallPreview();
  }
}

function placeWall(x1, z1, x2, z2, elev, thickness, color, type) {
  const length = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
  const height = State.project ? State.project.floorHeight : 3;
  const angle = Math.atan2(x2 - x1, z2 - z1);
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;

  const geo = new THREE.BoxGeometry(thickness, height, length);
  const mat = new THREE.MeshStandardMaterial({ color: color || 0xd4c5a9, roughness: 0.8, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, elev + height / 2, cz);
  mesh.rotation.y = angle;
  mesh.castShadow = true; mesh.receiveShadow = true;

  const id = uid();
  mesh.name = id;
  scene.add(mesh);

  const obj = {
    id, type, floor: State.currentFloor, mesh,
    data: { x1, z1, x2, z2, elev, thickness, color, height, length,
      material: type === 'partition' ? 'concrete' : 'plaster' }
  };
  pushHistory('add', obj);
  State.objects.push(obj);
  updateSchedule();
  markDirty();
  showToast(`${type === 'partition' ? 'Partition' : 'Wall'} placed — ${length.toFixed(2)}m × ${height.toFixed(2)}m`, 'success');
}

function updateWallPreview(x1, z1, x2, z2, elev, thickness) {
  removeWallPreview();
  const length = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
  if (length < 0.1) return;
  const height = State.project ? State.project.floorHeight : 3;
  const angle = Math.atan2(x2 - x1, z2 - z1);
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const geo = new THREE.BoxGeometry(thickness || 0.23, height, length);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.35, wireframe: false });
  wallPreviewMesh = new THREE.Mesh(geo, mat);
  wallPreviewMesh.position.set(cx, elev + height / 2, cz);
  wallPreviewMesh.rotation.y = angle;
  scene.add(wallPreviewMesh);
}

function removeWallPreview() {
  if (wallPreviewMesh) { scene.remove(wallPreviewMesh); wallPreviewMesh = null; }
}

// ─── COLUMN ───────────────────────────────────
function placeColumn(x, z, elev) {
  const w = 0.3, d = 0.3;
  const h = State.project ? State.project.floorHeight : 3;
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color: 0xc0a060, roughness: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, elev + h / 2, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const id = uid(); mesh.name = id; scene.add(mesh);
  const obj = { id, type: 'column', floor: State.currentFloor, mesh, data: { x, z, elev, w, d, h, material: 'concrete' } };
  pushHistory('add', obj); State.objects.push(obj);
  updateSchedule(); markDirty();
  showToast(`Column placed — ${w*100}×${d*100}cm`, 'success');
}

// ─── BEAM ─────────────────────────────────────
function doBeamClick(x, z, elev) {
  if (!beamStart) { beamStart = { x, z, elev }; showToast('Beam start set. Click end point.'); }
  else {
    placeBeam(beamStart.x, beamStart.z, x, z, elev); beamStart = null;
  }
}
function placeBeam(x1, z1, x2, z2, elev) {
  const length = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
  if (length < 0.2) { beamStart = null; return; }
  const bw = 0.3, bh = 0.4, angle = Math.atan2(x2 - x1, z2 - z1);
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const geo = new THREE.BoxGeometry(bw, bh, length);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  const beamY = elev + (State.project ? State.project.floorHeight : 3) - bh / 2;
  mesh.position.set(cx, beamY, cz);
  mesh.rotation.y = angle;
  mesh.castShadow = true;
  const id = uid(); mesh.name = id; scene.add(mesh);
  const obj = { id, type: 'beam', floor: State.currentFloor, mesh, data: { x1, z1, x2, z2, elev, bw, bh, length } };
  pushHistory('add', obj); State.objects.push(obj);
  updateSchedule(); markDirty();
  showToast(`Beam placed — ${length.toFixed(2)}m`, 'success');
}

// ─── SLAB ─────────────────────────────────────
function doSlabClick(x, z, elev) {
  slabPoints.push({ x, z });
  if (slabPoints.length === 2) {
    const p1 = slabPoints[0], p2 = slabPoints[1];
    const sx = (p1.x + p2.x) / 2, sz = (p1.z + p2.z) / 2;
    const sw = Math.abs(p2.x - p1.x) || 1, sd = Math.abs(p2.z - p1.z) || 1;
    const thickness = State.project ? State.project.slabThickness : 0.15;
    const geo = new THREE.BoxGeometry(sw, thickness, sd);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9E9E9E, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(sx, elev + (State.project ? State.project.floorHeight : 3) - thickness / 2, sz);
    mesh.receiveShadow = true; mesh.castShadow = true;
    const id = uid(); mesh.name = id; scene.add(mesh);
    const obj = { id, type: 'slab', floor: State.currentFloor, mesh, data: { sx, sz, sw, sd, thickness, area: sw * sd } };
    pushHistory('add', obj); State.objects.push(obj);
    updateSchedule(); markDirty(); slabPoints = [];
    showToast(`Slab placed — ${sw.toFixed(2)}×${sd.toFixed(2)}m`, 'success');
  } else showToast('Slab corner 1 set. Click opposite corner.');
}

// ─── DOOR / WINDOW ────────────────────────────
function placeDoorWindow(x, z, elev, type) {
  const isDoor = type === 'door';
  const w = isDoor ? 0.9 : 1.2, h = isDoor ? 2.1 : 1.2, d = 0.15;
  const frameH = isDoor ? 2.1 : 0.9;
  const yOff = isDoor ? 0 : 0.9;

  const group = new THREE.Group();

  // Frame
  const frameMat = new THREE.MeshStandardMaterial({ color: isDoor ? 0x5C3D1E : 0x90BEE8, roughness: 0.5 });
  const topGeo = new THREE.BoxGeometry(w + 0.1, 0.1, d);
  const topFrame = new THREE.Mesh(topGeo, frameMat);
  topFrame.position.y = frameH + 0.05;
  group.add(topFrame);

  const sideGeo = new THREE.BoxGeometry(0.08, frameH, d);
  [-w / 2 - 0.04, w / 2 + 0.04].forEach(sx => {
    const sf = new THREE.Mesh(sideGeo, frameMat);
    sf.position.set(sx, frameH / 2, 0); group.add(sf);
  });

  // Panel
  if (isDoor) {
    const panGeo = new THREE.BoxGeometry(w - 0.06, h - 0.06, 0.05);
    const panMat = new THREE.MeshStandardMaterial({ color: 0x7D5227, roughness: 0.4 });
    const pan = new THREE.Mesh(panGeo, panMat);
    pan.position.y = h / 2; group.add(pan);
    // Handle
    const hGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const hMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.8, roughness: 0.2 });
    const handle = new THREE.Mesh(hGeo, hMat);
    handle.position.set(w / 2 - 0.12, h / 2, 0.06); group.add(handle);
  } else {
    // Glass panel
    const panGeo = new THREE.BoxGeometry(w - 0.06, h - 0.06, 0.04);
    const panMat = new THREE.MeshStandardMaterial({ color: 0xadd8e6, transparent: true, opacity: 0.4, roughness: 0.05, metalness: 0.1 });
    const pan = new THREE.Mesh(panGeo, panMat);
    pan.position.y = h / 2 + yOff; group.add(pan);
  }

  group.position.set(x, elev + yOff, z);
  const id = uid();
  group.name = id;
  group.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  scene.add(group);

  const obj = { id, type, floor: State.currentFloor, mesh: group,
    data: { x, z, elev, w, h, d, frameH, yOff, material: isDoor ? 'wood' : 'glass' } };
  pushHistory('add', obj); State.objects.push(obj);
  updateSchedule(); markDirty();
  showToast(`${isDoor ? 'Door' : 'Window'} placed — ${w}×${h}m`, 'success');
}

// ─── LINTEL ───────────────────────────────────
function placeLintel(x, z, elev) {
  const floorH = State.project ? State.project.floorHeight : 3;
  const geo = new THREE.BoxGeometry(1.4, 0.15, 0.25);
  const mat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, elev + 2.15 + 0.075, z);
  mesh.castShadow = true;
  const id = uid(); mesh.name = id; scene.add(mesh);
  const obj = { id, type: 'lintel', floor: State.currentFloor, mesh, data: { x, z, elev, w: 1.4, h: 0.15, d: 0.25 } };
  pushHistory('add', obj); State.objects.push(obj); updateSchedule(); markDirty();
  showToast('Lintel placed.', 'success');
}

// ─── STAIR ────────────────────────────────────
function placeStair(x, z, elev) {
  const numSteps = 13, stepH = 0.18, stepD = 0.27, stepW = 1.0;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xC8B99A, roughness: 0.8 });

  for (let i = 0; i < numSteps; i++) {
    const geo = new THREE.BoxGeometry(stepW, stepH, stepD);
    const step = new THREE.Mesh(geo, mat);
    step.position.set(0, elev + (i + 0.5) * stepH, i * stepD);
    step.castShadow = true; step.receiveShadow = true;
    group.add(step);
  }

  // Railing posts
  const postMat = new THREE.MeshStandardMaterial({ color: 0x808080, metalness: 0.6, roughness: 0.3 });
  for (let i = 0; i <= numSteps; i += 3) {
    const pGeo = new THREE.BoxGeometry(0.06, 0.9, 0.06);
    const post = new THREE.Mesh(pGeo, postMat);
    post.position.set(stepW / 2 + 0.03, elev + i * stepH + 0.45, i * stepD);
    group.add(post);
  }

  group.position.set(x - stepW / 2, 0, z);
  const id = uid(); group.name = id;
  group.traverse(c => { if (c.isMesh) c.castShadow = true; });
  scene.add(group);
  const obj = { id, type: 'stair', floor: State.currentFloor, mesh: group,
    data: { x, z, elev, numSteps, stepH, stepD, stepW, totalH: numSteps * stepH } };
  pushHistory('add', obj); State.objects.push(obj); updateSchedule(); markDirty();
  showToast(`Staircase placed — ${numSteps} steps, ${(numSteps * stepH).toFixed(2)}m rise`, 'success');
}

// ─── RAMP ─────────────────────────────────────
function doRampClick(x, z, elev) {
  if (!rampStart) { rampStart = { x, z, elev }; showToast('Ramp start set. Click end.'); }
  else {
    const dx = x - rampStart.x, dz = z - rampStart.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const rise = State.project ? State.project.floorHeight * 0.4 : 1.2;
    const geo = new THREE.BoxGeometry(1.5, 0.15, length);
    const mat = new THREE.MeshStandardMaterial({ color: 0xA0A0A0, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    const cx = (rampStart.x + x) / 2, cz = (rampStart.z + z) / 2;
    mesh.position.set(cx, elev + rise / 2, cz);
    mesh.rotation.y = Math.atan2(dx, dz);
    mesh.rotation.x = -Math.atan2(rise, length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const id = uid(); mesh.name = id; scene.add(mesh);
    const obj = { id, type: 'ramp', floor: State.currentFloor, mesh, data: { x1: rampStart.x, z1: rampStart.z, x2: x, z2: z, elev, length, rise } };
    pushHistory('add', obj); State.objects.push(obj); updateSchedule(); markDirty();
    rampStart = null;
    showToast(`Ramp placed — ${length.toFixed(2)}m`, 'success');
  }
}

// ─── RAILING ──────────────────────────────────
function doRailingClick(x, z, elev) {
  if (!railingStart) { railingStart = { x, z, elev }; showToast('Railing start set. Click end.'); }
  else {
    const dx = x - railingStart.x, dz = z - railingStart.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const rh = 1.0;
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x808080, metalness: 0.6, roughness: 0.3 });
    // Handrail
    const hrGeo = new THREE.BoxGeometry(0.05, 0.05, length);
    const hr = new THREE.Mesh(hrGeo, mat);
    hr.position.set(0, rh, 0); group.add(hr);
    // Posts
    const numPosts = Math.max(2, Math.floor(length / 0.5));
    for (let i = 0; i <= numPosts; i++) {
      const pGeo = new THREE.BoxGeometry(0.05, rh, 0.05);
      const post = new THREE.Mesh(pGeo, mat);
      post.position.set(0, rh / 2, (i / numPosts - 0.5) * length); group.add(post);
    }
    const cx = (railingStart.x + x) / 2, cz = (railingStart.z + z) / 2;
    group.position.set(cx, elev, cz);
    group.rotation.y = Math.atan2(dx, dz);
    const id = uid(); group.name = id;
    group.traverse(c => { if (c.isMesh) c.castShadow = true; });
    scene.add(group);
    const obj = { id, type: 'railing', floor: State.currentFloor, mesh: group, data: { x1: railingStart.x, z1: railingStart.z, x2: x, z2: z, elev, length, rh } };
    pushHistory('add', obj); State.objects.push(obj); updateSchedule(); markDirty();
    railingStart = null;
    showToast(`Railing placed — ${length.toFixed(2)}m`, 'success');
  }
}

// ─── ROOM ─────────────────────────────────────
let roomClickCount = 0;
let roomFirstPt = null;

function doRoomClick(x, z, elev) {
  if (!roomFirstPt) { roomFirstPt = { x, z }; showToast('Room corner 1 set. Click opposite corner.'); roomClickCount = 1; }
  else {
    const p1 = roomFirstPt;
    const rw = Math.abs(x - p1.x), rd = Math.abs(z - p1.z);
    if (rw < 0.5 || rd < 0.5) { showToast('Room too small. Try again.', 'error'); roomFirstPt = null; return; }
    const cx = (p1.x + x) / 2, cz = (p1.z + z) / 2;
    const area = rw * rd;
    const roomTypes = ['Living Room', 'Bedroom', 'Kitchen', 'Bathroom', 'Dining Room', 'Storage'];
    const typeIdx = State.rooms.filter(r => r.floor === State.currentFloor).length % roomTypes.length;
    const roomColors = ['#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
    const color = roomColors[State.rooms.length % roomColors.length];

    const id = uid();
    const room = { id, name: roomTypes[typeIdx], floor: State.currentFloor,
      color, area, bounds: { x1: p1.x, z1: p1.z, x2: x, z2: z, cx, cz, rw, rd }, elev };

    // Ghost floor slab for room
    const geo = new THREE.BoxGeometry(rw, 0.02, rd);
    const mat = new THREE.MeshStandardMaterial({ color: parseInt(color.replace('#', '0x')), transparent: true, opacity: 0.18 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, elev + 0.01, cz);
    mesh.name = id; scene.add(mesh);
    room.mesh = mesh;

    State.rooms.push(room);
    updateRoomsList();
    markDirty();
    roomFirstPt = null;
    showToast(`Room "${room.name}" placed — ${rw.toFixed(2)}×${rd.toFixed(2)}m (${area.toFixed(2)} m²)`, 'success');
  }
}

// ─── LIGHT ────────────────────────────────────
function placeLight(x, z, elev) {
  const floorH = State.project ? State.project.floorHeight : 3;
  const cy = elev + floorH - 0.1;
  const group = new THREE.Group();

  // Housing
  const geo = new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffee, emissiveIntensity: 1, roughness: 0.2 });
  const fixture = new THREE.Mesh(geo, mat);
  group.add(fixture);

  // Point light
  const light = new THREE.PointLight(0xfff8e7, 1.5, 8, 2);
  light.position.y = -0.1; light.castShadow = true;
  group.add(light);

  group.position.set(x, cy, z);
  const id = uid(); group.name = id; scene.add(group);
  const obj = { id, type: 'light', floor: State.currentFloor, mesh: group,
    data: { x, z, elev: cy, brightness: 1.5, colorTemp: 3000, mountH: floorH, type: 'pendant' } };
  pushHistory('add', obj); State.objects.push(obj); updateSchedule(); markDirty();
  showToast('Light fixture placed.', 'success');
}

// ─── FAN ──────────────────────────────────────
function placeFan(x, z, elev) {
  const floorH = State.project ? State.project.floorHeight : 3;
  const cy = elev + floorH - 0.15;
  const group = new THREE.Group();

  const hubMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 16), hubMat);
  group.add(hub);

  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x5C3D1E, roughness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const bGeo = new THREE.BoxGeometry(0.6, 0.02, 0.12);
    const blade = new THREE.Mesh(bGeo, bladeMat);
    blade.position.x = 0.3;
    const wrap = new THREE.Group(); wrap.add(blade);
    wrap.rotation.y = (i * Math.PI) / 2;
    group.add(wrap);
  }

  group.position.set(x, cy, z);
  const id = uid(); group.name = id; scene.add(group);
  const obj = { id, type: 'fan', floor: State.currentFloor, mesh: group,
    data: { x, z, elev: cy, blades: 4, diameter: 1.2, rpm: 150 } };
  pushHistory('add', obj); State.objects.push(obj); updateSchedule(); markDirty();
  showToast('Ceiling fan placed.', 'success');
}

// ─── ROOF ─────────────────────────────────────
function placeRoof(x, z, elev) {
  const floorH = State.project ? State.project.floorHeight : 3;
  const ry = elev + floorH;
  const w = 5, d = 5;
  const group = new THREE.Group();

  // Hip roof geometry
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -d / 2);
  shape.lineTo(w / 2, -d / 2);
  shape.lineTo(w / 2, d / 2);
  shape.lineTo(-w / 2, d / 2);
  shape.closePath();

  const geo = new THREE.ConeGeometry(Math.max(w, d) / 1.5, 1.8, 4);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, ry + 0.9, z);
  mesh.castShadow = true;
  group.add(mesh);

  const id = uid(); group.name = id; scene.add(group);
  const obj = { id, type: 'roof', floor: State.currentFloor, mesh: group,
    data: { x, z, elev: ry, w, d, pitch: 30, material: 'tile' } };
  pushHistory('add', obj); State.objects.push(obj); updateSchedule(); markDirty();
  showToast('Roof element placed.', 'success');
}

// ─── BALCONY ──────────────────────────────────
function placeBalcony(x, z, elev) {
  const floorH = State.project ? State.project.floorHeight : 3;
  const bw = 3, bd = 1.5, slabT = 0.15;
  const group = new THREE.Group();

  const slabMat = new THREE.MeshStandardMaterial({ color: 0xC8C8C8, roughness: 0.9 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(bw, slabT, bd), slabMat);
  slab.position.set(0, 0, 0); group.add(slab);

  // Railing
  const railMat = new THREE.MeshStandardMaterial({ color: 0x808080, metalness: 0.5 });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.05, 0.05), railMat);
  rail.position.set(0, 1.0, bd / 2); group.add(rail);
  for (let i = -bw / 2; i <= bw / 2; i += 0.5) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), railMat);
    post.position.set(i, 0.5, bd / 2); group.add(post);
  }

  group.position.set(x, elev + floorH - slabT / 2, z);
  group.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  const id = uid(); group.name = id; scene.add(group);
  const obj = { id, type: 'balcony', floor: State.currentFloor, mesh: group,
    data: { x, z, elev: elev + floorH, bw, bd, slabT, area: bw * bd } };
  pushHistory('add', obj); State.objects.push(obj); updateSchedule(); markDirty();
  showToast(`Balcony placed — ${bw}×${bd}m`, 'success');
}

// ─── FOUNDATION ───────────────────────────────
function placeFoundation(x, z, elev) {
  const fw = 1.2, fd = 1.2, fh = 0.6;
  const geo = new THREE.BoxGeometry(fw, fh, fd);
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, elev - fh / 2, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const id = uid(); mesh.name = id; scene.add(mesh);
  const obj = { id, type: 'foundation', floor: State.currentFloor, mesh,
    data: { x, z, elev, fw, fd, fh, material: 'PCC' } };
  pushHistory('add', obj); State.objects.push(obj); updateSchedule(); markDirty();
  showToast(`Footing placed — ${fw}×${fd}×${fh}m`, 'success');
}

// ─── FALSE CEILING ────────────────────────────
function placeFalseCeiling(x, z, elev) {
  const floorH = State.project ? State.project.floorHeight : 3;
  const ceilH = floorH - 0.4;
  const w = 2.4, d = 2.4, t = 0.05;
  const geo = new THREE.BoxGeometry(w, t, d);
  const mat = new THREE.MeshStandardMaterial({ color: 0xF5F5F0, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, elev + ceilH, z);
  mesh.receiveShadow = true;
  const id = uid(); mesh.name = id; scene.add(mesh);
  const obj = { id, type: 'false-ceiling', floor: State.currentFloor, mesh,
    data: { x, z, elev: elev + ceilH, w, d, t, style: 'flat' } };
  pushHistory('add', obj); State.objects.push(obj); markDirty();
  showToast('False ceiling panel placed.', 'success');
}

// ─── MEASURE ──────────────────────────────────
let measureHelpers = [];
function doMeasure(x, z, y) {
  State.measurePoints.push({ x, y, z });
  if (State.measurePoints.length === 2) {
    const p1 = State.measurePoints[0], p2 = State.measurePoints[1];
    const d = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2 + (p2.z - p1.z) ** 2);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: (p1.z + p2.z) / 2 };
    document.getElementById('measure-text').textContent = `Distance: ${d.toFixed(3)} m | Horizontal: ${Math.sqrt((p2.x - p1.x) ** 2 + (p2.z - p1.z) ** 2).toFixed(3)} m`;

    // Draw line
    const pts = [new THREE.Vector3(p1.x, p1.y, p1.z), new THREE.Vector3(p2.x, p2.y, p2.z)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    scene.add(line); measureHelpers.push(line);

    // Sphere endpoints
    [p1, p2].forEach(p => {
      const sGeo = new THREE.SphereGeometry(0.08, 8, 8);
      const sMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.5 });
      const sp = new THREE.Mesh(sGeo, sMat);
      sp.position.set(p.x, p.y, p.z); scene.add(sp); measureHelpers.push(sp);
    });

    State.measurePoints = [];
    setTimeout(() => document.getElementById('measure-text').textContent = 'Click to start measuring', 4000);
  } else {
    document.getElementById('measure-text').textContent = `Start set. Click end point.`;
  }
}
function updateMeasurePreview(p1, p2) {
  removeMeasureHelpers();
  const pts = [new THREE.Vector3(p1.x, p1.y, p1.z), new THREE.Vector3(p2.x, p2.y, p2.z)];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.5 });
  const line = new THREE.Line(geo, mat);
  scene.add(line); measureHelpers.push(line);
}
function removeMeasureHelpers() {
  measureHelpers.forEach(m => scene.remove(m)); measureHelpers = [];
}

// ═══════════════════════════════════════════════
// SELECTION
// ═══════════════════════════════════════════════
function doSelect(e) {
  const ws = document.getElementById('workspace');
  const rect = ws.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  const meshes = State.objects.map(o => o.mesh).filter(Boolean);
  const allMeshes = [];
  meshes.forEach(m => { if (m.isMesh) allMeshes.push(m); else m.traverse(c => { if (c.isMesh) allMeshes.push(c); }); });

  const hits = raycaster.intersectObjects(allMeshes, true);
  if (hits.length) {
    let hitMesh = hits[0].object;
    // Walk up to find top-level object
    while (hitMesh.parent && hitMesh.parent !== scene) hitMesh = hitMesh.parent;
    const found = State.objects.find(o => o.mesh === hitMesh || (hitMesh.name && o.id === hitMesh.name));
    if (found) { selectObject(found); return; }
  }
  clearSelection();
}

function selectObject(obj) {
  clearSelection();
  State.selectedObject = obj;
  // Highlight
  obj.mesh.traverse(c => {
    if (c.isMesh && c.material) {
      c.material._origEmissive = c.material.emissive ? c.material.emissive.getHex() : 0;
      if (c.material.emissive) c.material.emissive.setHex(0x2244aa);
    }
  });
  showPropertiesPanel(obj);
}

function clearSelection() {
  if (State.selectedObject) {
    State.selectedObject.mesh.traverse(c => {
      if (c.isMesh && c.material && c.material._origEmissive !== undefined) {
        if (c.material.emissive) c.material.emissive.setHex(c.material._origEmissive);
      }
    });
  }
  State.selectedObject = null;
  document.getElementById('rp-selection').style.display = 'none';
  document.getElementById('rp-material').style.display = 'none';
}

function deleteSelected() {
  if (!State.selectedObject) return;
  const obj = State.selectedObject;
  scene.remove(obj.mesh);
  State.objects = State.objects.filter(o => o.id !== obj.id);
  clearSelection();
  pushHistory('delete', obj);
  updateSchedule();
  markDirty();
  showToast('Object deleted.', '');
}

function duplicateSelected() {
  if (!State.selectedObject) return;
  const obj = State.selectedObject;
  // Re-place at offset
  const d = obj.data;
  if (obj.type === 'wall' || obj.type === 'partition') {
    placeWall(d.x1 + 1, d.z1 + 1, d.x2 + 1, d.z2 + 1, d.elev, d.thickness, d.color, obj.type);
  } else if (obj.type === 'column') placeColumn(d.x + 1, d.z, d.elev);
  else showToast('Duplicate: select an object and use Ctrl+D', '');
}

function cancelPlacement() {
  wallStart = null; beamStart = null; rampStart = null; railingStart = null; roomFirstPt = null; slabPoints = [];
  removeWallPreview();
}

// ═══════════════════════════════════════════════
// PROPERTIES PANEL
// ═══════════════════════════════════════════════
const propDefs = {
  wall:        [['Length','length','m'],['Height','height','m'],['Thickness','thickness','m'],['Material','material','str']],
  partition:   [['Length','length','m'],['Height','height','m'],['Thickness','thickness','m']],
  column:      [['Width','w','m'],['Depth','d','m'],['Height','h','m'],['Material','material','str']],
  beam:        [['Length','length','m'],['Width','bw','m'],['Height','bh','m']],
  slab:        [['Width','sw','m'],['Depth','sd','m'],['Thickness','thickness','m'],['Area','area','m²']],
  door:        [['Width','w','m'],['Height','h','m'],['Material','material','str']],
  window:      [['Width','w','m'],['Height','h','m'],['Material','material','str']],
  stair:       [['Steps','numSteps',''],['Step Height','stepH','m'],['Step Depth','stepD','m'],['Width','stepW','m'],['Total Rise','totalH','m']],
  ramp:        [['Length','length','m'],['Rise','rise','m']],
  railing:     [['Length','length','m'],['Height','rh','m']],
  light:       [['Brightness','brightness',''],['Color Temp','colorTemp','K'],['Mount H','mountH','m']],
  fan:         [['Blades','blades',''],['Diameter','diameter','m']],
  roof:        [['Width','w','m'],['Depth','d','m'],['Pitch','pitch','°'],['Material','material','str']],
  balcony:     [['Width','bw','m'],['Depth','bd','m'],['Area','area','m²']],
  foundation:  [['Width','fw','m'],['Depth','fd','m'],['Height','fh','m'],['Material','material','str']],
  lintel:      [['Width','w','m'],['Height','h','m'],['Depth','d','m']],
  'false-ceiling': [['Width','w','m'],['Depth','d','m'],['Thickness','t','m'],['Style','style','str']],
};

function showPropertiesPanel(obj) {
  const selEl = document.getElementById('rp-selection');
  const matEl = document.getElementById('rp-material');
  selEl.style.display = 'block';
  document.getElementById('rp-sel-type').textContent = obj.type.toUpperCase().replace('-', ' ');

  const fields = document.getElementById('rp-sel-fields');
  fields.innerHTML = '';

  const defs = propDefs[obj.type] || [];
  defs.forEach(([label, key, unit]) => {
    const val = obj.data[key];
    if (val === undefined) return;
    const row = document.createElement('div'); row.className = 'rp-row';
    const lbl = document.createElement('span'); lbl.className = 'rp-label'; lbl.textContent = label;

    const isEditable = unit !== 'm²' && key !== 'area' && key !== 'totalH';
    if (isEditable && typeof val !== 'string') {
      const inp = document.createElement('input'); inp.type = 'number'; inp.className = 'rp-input';
      inp.value = typeof val === 'number' ? val.toFixed(typeof val < 1 ? 3 : 2) : val;
      inp.step = key === 'numSteps' ? 1 : 0.01;
      inp.addEventListener('change', () => { obj.data[key] = parseFloat(inp.value); refreshObjectMesh(obj); markDirty(); });
      row.append(lbl, inp);
    } else if (typeof val === 'string') {
      const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'rp-input rp-input-full';
      inp.value = val;
      inp.addEventListener('change', () => { obj.data[key] = inp.value; markDirty(); });
      row.append(lbl, inp);
    } else {
      const v = document.createElement('span'); v.className = 'rp-value';
      v.textContent = (typeof val === 'number' ? val.toFixed(2) : val) + (unit ? ' ' + unit : '');
      row.append(lbl, v);
    }
    fields.appendChild(row);
  });

  // Position row
  ['x', 'z', 'elev'].forEach(coord => {
    const v = obj.data[coord] ?? (obj.mesh ? obj.mesh.position[coord === 'elev' ? 'y' : coord] : 0);
    const row = document.createElement('div'); row.className = 'rp-row';
    const lbl = document.createElement('span'); lbl.className = 'rp-label'; lbl.textContent = coord === 'elev' ? 'Elevation' : coord.toUpperCase();
    const inp = document.createElement('input'); inp.type = 'number'; inp.className = 'rp-input'; inp.value = parseFloat(v).toFixed(2); inp.step = 0.1;
    inp.addEventListener('change', () => {
      if (obj.mesh) {
        if (coord === 'x') obj.mesh.position.x = parseFloat(inp.value);
        else if (coord === 'z') obj.mesh.position.z = parseFloat(inp.value);
        else obj.mesh.position.y = parseFloat(inp.value);
      }
      markDirty();
    });
    row.append(lbl, inp); fields.appendChild(row);
  });

  // Material panel
  matEl.style.display = 'block';
  const mp = document.getElementById('material-picker');
  mp.innerHTML = '';
  const mats = [
    { name: 'Plaster', color: '#d4c5a9' }, { name: 'Concrete', color: '#9e9e9e' },
    { name: 'Brick', color: '#c87941' }, { name: 'Stone', color: '#8d8068' },
    { name: 'Tile', color: '#e0dbd0' }, { name: 'Wood', color: '#7D5227' },
    { name: 'Glass', color: '#add8e6' }, { name: 'Metal', color: '#b0b8c1' },
    { name: 'Paint', color: '#f0f0f0' }, { name: 'Marble', color: '#f5f5f5' },
  ];
  mats.forEach(m => {
    const sw = document.createElement('div'); sw.className = 'mat-swatch';
    sw.style.background = m.color; sw.title = m.name;
    sw.addEventListener('click', () => {
      document.querySelectorAll('.mat-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      applyColor(obj, m.color);
      document.getElementById('mat-color').value = m.color;
    });
    mp.appendChild(sw);
  });

  // Sync color picker
  document.getElementById('mat-color').onchange = e => applyColor(obj, e.target.value);
  document.getElementById('mat-rough').onchange = e => applyRoughness(obj, parseFloat(e.target.value));
  document.getElementById('mat-metal').onchange = e => applyMetalness(obj, parseFloat(e.target.value));
}

function applyColor(obj, hex) {
  const col = new THREE.Color(hex);
  obj.mesh.traverse(c => { if (c.isMesh && c.material) { if (Array.isArray(c.material)) c.material.forEach(m => m.color.set(col)); else c.material.color.set(col); } });
  markDirty();
}
function applyRoughness(obj, val) {
  obj.mesh.traverse(c => { if (c.isMesh && c.material && !Array.isArray(c.material) && c.material.roughness !== undefined) c.material.roughness = val; });
}
function applyMetalness(obj, val) {
  obj.mesh.traverse(c => { if (c.isMesh && c.material && !Array.isArray(c.material) && c.material.metalness !== undefined) c.material.metalness = val; });
}

function refreshObjectMesh(obj) {
  // Simple: update position scale for box geometry objects
  if (obj.mesh.isMesh && obj.mesh.geometry.type === 'BoxGeometry') {
    const d = obj.data;
    if (obj.type === 'slab') {
      obj.mesh.geometry.dispose();
      obj.mesh.geometry = new THREE.BoxGeometry(d.sw, d.thickness, d.sd);
    }
  }
}

// ═══════════════════════════════════════════════
// OBJECT LIBRARY
// ═══════════════════════════════════════════════
const LibraryItems = [
  // Furniture
  { cat: 'furniture', name: 'Double Bed', icon: '🛏', w: 1.5, d: 2.0, h: 0.5, color: 0x6B4F2E },
  { cat: 'furniture', name: 'Single Bed', icon: '🛏', w: 0.9, d: 2.0, h: 0.45, color: 0x8B6914 },
  { cat: 'furniture', name: 'Wardrobe', icon: '🚪', w: 1.8, d: 0.6, h: 2.1, color: 0x5C3D1E },
  { cat: 'furniture', name: 'Sofa 3-Seat', icon: '🛋', w: 2.2, d: 0.9, h: 0.85, color: 0x4A5568 },
  { cat: 'furniture', name: 'Armchair', icon: '💺', w: 0.9, d: 0.85, h: 0.85, color: 0x6B7280 },
  { cat: 'furniture', name: 'Dining Table', icon: '🪑', w: 1.6, d: 0.9, h: 0.75, color: 0x7D5227 },
  { cat: 'furniture', name: 'Coffee Table', icon: '🪑', w: 1.2, d: 0.6, h: 0.42, color: 0x8B6914 },
  { cat: 'furniture', name: 'Study Desk', icon: '🖥', w: 1.2, d: 0.6, h: 0.75, color: 0x5C3D1E },
  { cat: 'furniture', name: 'Bookshelf', icon: '📚', w: 1.0, d: 0.3, h: 2.0, color: 0x4A3728 },
  { cat: 'furniture', name: 'TV Cabinet', icon: '📺', w: 1.8, d: 0.45, h: 0.5, color: 0x222222 },
  // Kitchen
  { cat: 'kitchen', name: 'Counter L', icon: '🍳', w: 2.4, d: 0.6, h: 0.9, color: 0xE8D5B7 },
  { cat: 'kitchen', name: 'Wall Cabinet', icon: '🗄', w: 0.6, d: 0.35, h: 0.7, color: 0xF5F0E8 },
  { cat: 'kitchen', name: 'Sink', icon: '🚿', w: 0.8, d: 0.5, h: 0.2, color: 0xC0C0C0 },
  { cat: 'kitchen', name: 'Cooktop', icon: '🔥', w: 0.6, d: 0.5, h: 0.05, color: 0x333333 },
  { cat: 'kitchen', name: 'Refrigerator', icon: '🧊', w: 0.65, d: 0.65, h: 1.7, color: 0xE8E8E8 },
  { cat: 'kitchen', name: 'Oven', icon: '♨️', w: 0.6, d: 0.55, h: 0.85, color: 0x888888 },
  // Bathroom
  { cat: 'bathroom', name: 'Toilet WC', icon: '🚽', w: 0.36, d: 0.7, h: 0.4, color: 0xF5F5F0 },
  { cat: 'bathroom', name: 'Basin', icon: '🪣', w: 0.55, d: 0.45, h: 0.85, color: 0xF5F5F0 },
  { cat: 'bathroom', name: 'Shower', icon: '🚿', w: 0.9, d: 0.9, h: 2.1, color: 0xC8E8F8 },
  { cat: 'bathroom', name: 'Bathtub', icon: '🛁', w: 0.75, d: 1.7, h: 0.55, color: 0xF0F0F5 },
  // Exterior
  { cat: 'exterior', name: 'Gate', icon: '🚪', w: 3.5, d: 0.1, h: 1.8, color: 0x333333 },
  { cat: 'exterior', name: 'Plant', icon: '🌿', w: 0.5, d: 0.5, h: 1.2, color: 0x228B22 },
  { cat: 'exterior', name: 'Bench', icon: '🪑', w: 1.5, d: 0.5, h: 0.45, color: 0x8B6914 },
  { cat: 'exterior', name: 'Car Space', icon: '🚗', w: 2.5, d: 5.0, h: 0.05, color: 0x555555 },
  { cat: 'exterior', name: 'Parapet', icon: '🧱', w: 3.0, d: 0.15, h: 0.9, color: 0xd4c5a9 },
  // Electrical
  { cat: 'electrical', name: 'Switch', icon: '🔌', w: 0.08, d: 0.02, h: 0.08, color: 0xF0F0F0 },
  { cat: 'electrical', name: 'AC Unit', icon: '❄️', w: 0.85, d: 0.2, h: 0.28, color: 0xE0E8F0 },
  { cat: 'electrical', name: 'Panel', icon: '⚡', w: 0.4, d: 0.1, h: 0.6, color: 0x888888 },
];

function initLibrary() {
  const cats = ['all', ...new Set(LibraryItems.map(i => i.cat))];
  const catEl = document.getElementById('lib-categories');
  catEl.innerHTML = '';
  cats.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'lib-cat-btn' + (c === 'all' ? ' active' : '');
    btn.textContent = c.charAt(0).toUpperCase() + c.slice(1);
    btn.addEventListener('click', () => {
      State.libCategory = c;
      document.querySelectorAll('.lib-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderLibGrid();
    });
    catEl.appendChild(btn);
  });
  renderLibGrid();

  document.getElementById('lib-search').addEventListener('input', e => {
    renderLibGrid(e.target.value.toLowerCase());
  });
}

function renderLibGrid(search = '') {
  const grid = document.getElementById('lib-grid');
  grid.innerHTML = '';
  const items = LibraryItems.filter(item =>
    (State.libCategory === 'all' || item.cat === State.libCategory) &&
    (!search || item.name.toLowerCase().includes(search))
  );
  items.forEach(item => {
    const el = document.createElement('div'); el.className = 'lib-item';
    el.innerHTML = `<div class="lib-item-icon">${item.icon}</div>
      <div class="lib-item-name">${item.name}</div>
      <div class="lib-item-size">${item.w}×${item.d}×${item.h}m</div>`;
    el.addEventListener('click', () => placeLibItem(item));
    el.title = `Click to place ${item.name}`;
    grid.appendChild(el);
  });
  if (!items.length) grid.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px">No items found</div>';
}

function placeLibItem(item) {
  if (!State.project) { showToast('Open or create a project first.', 'error'); return; }
  const elev = getCurrentFloorElevation();
  const x = snap((Math.random() - 0.5) * 6), z = snap((Math.random() - 0.5) * 6);
  placeBoxObject(item, x, z, elev);
  showToast(`${item.name} placed. Use Select to move/resize.`, 'success');
  setTool('select');
}

function placeBoxObject(item, x, z, elev) {
  const geo = new THREE.BoxGeometry(item.w, item.h, item.d);
  let mat;
  if (item.cat === 'bathroom' && item.name.includes('Shower')) {
    mat = new THREE.MeshStandardMaterial({ color: item.color, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.1 });
  } else {
    mat = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.6 });
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, elev + item.h / 2, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const id = uid(); mesh.name = id; scene.add(mesh);
  const obj = { id, type: item.cat, name: item.name, floor: State.currentFloor, mesh,
    data: { x, z, elev, w: item.w, h: item.h, d: item.d, material: item.cat, color: '#' + item.color.toString(16).padStart(6, '0') } };
  pushHistory('add', obj); State.objects.push(obj);
  updateSchedule(); markDirty();
  return obj;
}

// ═══════════════════════════════════════════════
// LAYERS PANEL
// ═══════════════════════════════════════════════
function initLayers() {
  const list = document.getElementById('layers-list');
  list.innerHTML = '';
  Object.entries(State.layers).forEach(([key, layer]) => {
    const item = document.createElement('div'); item.className = 'layer-item';
    const vis = document.createElement('div'); vis.className = 'layer-vis' + (layer.visible ? ' on' : ''); vis.textContent = layer.visible ? '✓' : '';
    const col = document.createElement('div'); col.className = 'layer-color'; col.style.background = layer.color;
    const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = key.charAt(0).toUpperCase() + key.slice(1);
    const count = document.createElement('span'); count.className = 'layer-count'; count.id = `layer-count-${key}`;
    count.textContent = '0';
    vis.addEventListener('click', () => {
      layer.visible = !layer.visible;
      vis.classList.toggle('on', layer.visible); vis.textContent = layer.visible ? '✓' : '';
      toggleLayerVisibility(key, layer.visible);
    });
    item.append(vis, col, name, count);
    list.appendChild(item);
  });

  document.getElementById('btn-show-all').addEventListener('click', () => {
    Object.keys(State.layers).forEach(k => { State.layers[k].visible = true; toggleLayerVisibility(k, true); });
    initLayers();
  });
  document.getElementById('btn-hide-all').addEventListener('click', () => {
    Object.keys(State.layers).forEach(k => { State.layers[k].visible = false; toggleLayerVisibility(k, false); });
    initLayers();
  });
}

function toggleLayerVisibility(layer, visible) {
  State.objects.filter(o => getLayer(o.type) === layer).forEach(o => { if (o.mesh) o.mesh.visible = visible; });
  updateLayerCounts();
}

function getLayer(type) {
  if (['wall', 'partition'].includes(type)) return 'walls';
  if (['column'].includes(type)) return 'columns';
  if (['slab', 'foundation'].includes(type)) return 'slabs';
  if (['door'].includes(type)) return 'doors';
  if (['window', 'lintel'].includes(type)) return 'windows';
  if (['stair', 'ramp', 'railing'].includes(type)) return 'stairs';
  if (['roof', 'balcony'].includes(type)) return 'roofs';
  if (['furniture', 'kitchen', 'bathroom', 'exterior', 'electrical'].includes(type)) return 'furniture';
  if (['light', 'fan', 'false-ceiling'].includes(type)) return 'lights';
  return 'furniture';
}

function updateLayerCounts() {
  Object.keys(State.layers).forEach(k => {
    const el = document.getElementById(`layer-count-${k}`);
    if (el) el.textContent = State.objects.filter(o => getLayer(o.type) === k).length;
  });
}

// ═══════════════════════════════════════════════
// SCHEDULE + ROOMS
// ═══════════════════════════════════════════════
function updateSchedule() {
  // Object counts by type
  const counts = {};
  State.objects.forEach(o => { counts[o.type] = (counts[o.type] || 0) + 1; });

  const sg = document.getElementById('schedule-grid');
  sg.innerHTML = '';
  Object.entries(counts).forEach(([type, count]) => {
    const lbl = document.createElement('div'); lbl.className = 'sched-label'; lbl.textContent = type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' ');
    const val = document.createElement('div'); val.className = 'sched-value'; val.textContent = count;
    sg.append(lbl, val);
  });

  // Total floor area from slabs
  const slabArea = State.objects.filter(o => o.type === 'slab').reduce((s, o) => s + (o.data.area || 0), 0);
  document.getElementById('rp-proj-area').textContent = slabArea.toFixed(2) + ' m²';

  // Status bar
  document.getElementById('sb-objects').textContent = 'Objects: ' + State.objects.length;
  document.getElementById('sb-rooms-count').textContent = 'Rooms: ' + State.rooms.length;

  updateLayerCounts();
  updateRoomsList();
}

function updateRoomsList() {
  const list = document.getElementById('rooms-list');
  list.innerHTML = '';
  const floorRooms = State.rooms.filter(r => r.floor === State.currentFloor);
  floorRooms.forEach(r => {
    const item = document.createElement('div'); item.className = 'room-item';
    const dot = document.createElement('div'); dot.className = 'room-dot'; dot.style.background = r.color;
    const name = document.createElement('span'); name.className = 'room-name'; name.textContent = r.name;
    name.contentEditable = true; name.addEventListener('blur', () => { r.name = name.textContent; markDirty(); });
    const area = document.createElement('span'); area.className = 'room-area'; area.textContent = r.area.toFixed(2) + ' m²';
    item.append(dot, name, area); list.appendChild(item);
  });

  const total = State.rooms.reduce((s, r) => s + r.area, 0);
  document.getElementById('rp-total-area').textContent = total.toFixed(2) + ' m²';
  document.getElementById('sb-rooms-count').textContent = 'Rooms: ' + State.rooms.length;
}

// ═══════════════════════════════════════════════
// FLOOR MANAGEMENT
// ═══════════════════════════════════════════════
function buildFloorTabs() {
  const container = document.getElementById('floor-tabs');
  container.innerHTML = '';
  for (let i = 0; i < State.project.floors; i++) {
    const tab = document.createElement('button');
    tab.className = 'floor-tab' + (i === State.currentFloor ? ' active' : '');
    tab.textContent = i === 0 ? 'GF' : `F${i}`;
    tab.title = i === 0 ? 'Ground Floor' : `Floor ${i}`;
    tab.addEventListener('click', () => switchFloor(i));
    container.appendChild(tab);
  }
}

function switchFloor(i) {
  State.currentFloor = i;
  buildFloorTabs();
  // Show only objects on this floor (or all if desired)
  // For now show all floors but update labels
  document.getElementById('plan-floor-label').textContent =
    i === 0 ? 'Ground Floor Plan' : `Floor ${i} Plan`;
  if (State.viewMode === '2d') renderPlan2D();
  updateRoomsList();
  updateSchedule();
  showToast(i === 0 ? 'Ground Floor' : `Floor ${i} selected`);
}

document.getElementById('btn-add-floor').addEventListener('click', () => {
  if (!State.project) return;
  State.project.floors++;
  buildFloorTabs();
  showToast(`Floor ${State.project.floors - 1} added.`, 'success');
});

// ═══════════════════════════════════════════════
// VIEW MODES
// ═══════════════════════════════════════════════
function setViewMode(mode) {
  State.viewMode = mode;
  ['3d', '2d', 'elev', 'section'].forEach(m => document.getElementById(`vm-${m}`).classList.remove('active'));
  document.getElementById(`vm-${mode}`).classList.add('active');

  const tc = document.getElementById('three-canvas');
  const pc = document.getElementById('plan-canvas');
  const po = document.getElementById('plan-overlay');

  if (mode === '3d') {
    tc.style.display = 'block'; pc.style.display = 'none'; po.style.display = 'none';
    document.getElementById('viewport-controls').style.display = 'flex';
  } else {
    tc.style.display = 'none'; pc.style.display = 'block'; po.style.display = 'flex';
    document.getElementById('viewport-controls').style.display = 'none';
    if (mode === '2d') {
      document.getElementById('plan-floor-label').textContent =
        State.currentFloor === 0 ? 'Ground Floor Plan' : `Floor ${State.currentFloor} Plan`;
    } else if (mode === 'elev') {
      document.getElementById('plan-floor-label').textContent = 'Front Elevation';
    } else if (mode === 'section') {
      document.getElementById('plan-floor-label').textContent = 'Section A-A';
    }
    renderPlan2D();
  }
}

['3d', '2d', 'elev', 'section'].forEach(m => {
  document.getElementById(`vm-${m}`).addEventListener('click', () => setViewMode(m));
});

// ═══════════════════════════════════════════════
// 2D FLOOR PLAN RENDERER
// ═══════════════════════════════════════════════
let PLAN_SCALE = 30; // pixels per meter
let plan2DOffset = { x: 60, y: 60 };

function renderPlan2D() {
  const canvas = document.getElementById('plan-canvas');
  const ws = document.getElementById('workspace');
  canvas.width = ws.clientWidth;
  canvas.height = ws.clientHeight;
  const ctx = canvas.getContext('2d');
  const mode = State.viewMode;

  // Background
  ctx.fillStyle = '#f5f0e8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid
  drawPlanGrid(ctx, canvas.width, canvas.height);

  if (!State.project) return;

  if (mode === '2d') drawFloorPlan(ctx);
  else if (mode === 'elev') drawElevation(ctx, canvas.width, canvas.height, 'front');
  else if (mode === 'section') drawSection(ctx, canvas.width, canvas.height);

  // Border + title block
  drawTitleBlock(ctx, canvas.width, canvas.height, mode);
}

function drawPlanGrid(ctx, w, h) {
  ctx.strokeStyle = '#d0ccc0';
  ctx.lineWidth = 0.5;
  const grid = PLAN_SCALE * 0.5; // 0.5m grid
  for (let x = 0; x < w; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  // Major lines (1m)
  ctx.strokeStyle = '#c0bdb0';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += PLAN_SCALE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += PLAN_SCALE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}

function toP(wx, wz) {
  return { x: plan2DOffset.x + wx * PLAN_SCALE, y: plan2DOffset.y + wz * PLAN_SCALE };
}

function drawFloorPlan(ctx) {
  const fl = State.currentFloor;

  // Plot boundary
  if (State.project) {
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2; ctx.setLineDash([8, 4]);
    const p0 = toP(0, 0);
    ctx.strokeRect(p0.x, p0.y, State.project.plotWidth * PLAN_SCALE, State.project.plotDepth * PLAN_SCALE);
    ctx.setLineDash([]);
    ctx.font = 'bold 11px Inter'; ctx.fillStyle = '#555';
    ctx.fillText(`PLOT ${State.project.plotWidth}m × ${State.project.plotDepth}m`, p0.x + 4, p0.y - 6);
  }

  // Rooms (hatch fills)
  State.rooms.filter(r => r.floor === fl).forEach(r => {
    const b = r.bounds;
    const p1 = toP(b.x1, b.z1);
    const pw = b.rw * PLAN_SCALE, ph = b.rd * PLAN_SCALE;
    ctx.fillStyle = r.color + '22';
    ctx.fillRect(p1.x, p1.y, pw, ph);
    ctx.strokeStyle = r.color; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
    ctx.strokeRect(p1.x, p1.y, pw, ph);
    ctx.setLineDash([]);
    // Room label
    const cp = toP(b.cx, b.cz);
    ctx.fillStyle = '#333'; ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
    ctx.fillText(r.name, cp.x, cp.y - 5);
    ctx.font = '9px JetBrains Mono'; ctx.fillStyle = '#666';
    ctx.fillText(`${b.rw.toFixed(2)}×${b.rd.toFixed(2)}m`, cp.x, cp.y + 8);
    ctx.fillText(`${r.area.toFixed(2)} m²`, cp.x, cp.y + 20);
    ctx.textAlign = 'left';
  });

  // Walls
  State.objects.filter(o => (o.type === 'wall' || o.type === 'partition') && o.floor === fl).forEach(o => {
    const d = o.data;
    const p1 = toP(d.x1, d.z1), p2 = toP(d.x2, d.z2);
    const thickness = d.thickness * PLAN_SCALE;
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const nx = Math.sin(angle) * thickness / 2, ny = -Math.cos(angle) * thickness / 2;
    ctx.beginPath();
    ctx.moveTo(p1.x + nx, p1.y + ny); ctx.lineTo(p2.x + nx, p2.y + ny);
    ctx.lineTo(p2.x - nx, p2.y - ny); ctx.lineTo(p1.x - nx, p1.y - ny);
    ctx.closePath();
    ctx.fillStyle = o.type === 'partition' ? '#c8c8c8' : '#4a4a4a';
    ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = 0.5; ctx.stroke();

    // Dimension
    const len = d.length;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    ctx.save(); ctx.translate(mx, my); ctx.rotate(angle);
    ctx.font = '8px JetBrains Mono'; ctx.fillStyle = '#0066cc'; ctx.textAlign = 'center';
    ctx.fillText(len.toFixed(2) + 'm', 0, -thickness / 2 - 3);
    ctx.restore();
  });

  // Columns
  State.objects.filter(o => o.type === 'column' && o.floor === fl).forEach(o => {
    const d = o.data;
    const p = toP(d.x, d.z);
    const cw = d.w * PLAN_SCALE, cd = d.d * PLAN_SCALE;
    ctx.fillStyle = '#c0a060'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.fillRect(p.x - cw / 2, p.y - cd / 2, cw, cd);
    ctx.strokeRect(p.x - cw / 2, p.y - cd / 2, cw, cd);
    // Cross hatch
    ctx.strokeStyle = '#333'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(p.x - cw / 2, p.y - cd / 2); ctx.lineTo(p.x + cw / 2, p.y + cd / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x + cw / 2, p.y - cd / 2); ctx.lineTo(p.x - cw / 2, p.y + cd / 2); ctx.stroke();
  });

  // Doors
  State.objects.filter(o => o.type === 'door' && o.floor === fl).forEach(o => {
    const d = o.data;
    const p = toP(d.x, d.z);
    const dw = d.w * PLAN_SCALE;
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.x - dw / 2, p.y); ctx.lineTo(p.x + dw / 2, p.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x - dw / 2, p.y, dw, 0, Math.PI / 2); ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 0.8; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
  });

  // Windows
  State.objects.filter(o => o.type === 'window' && o.floor === fl).forEach(o => {
    const d = o.data;
    const p = toP(d.x, d.z);
    const ww = d.w * PLAN_SCALE;
    // Double line for window
    ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x - ww / 2, p.y - 2); ctx.lineTo(p.x + ww / 2, p.y - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x - ww / 2, p.y + 2); ctx.lineTo(p.x + ww / 2, p.y + 2); ctx.stroke();
  });

  // Stairs
  State.objects.filter(o => o.type === 'stair' && o.floor === fl).forEach(o => {
    const d = o.data;
    const p = toP(d.x, d.z);
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1; ctx.fillStyle = '#fff3e0';
    const sw = d.stepW * PLAN_SCALE, sl = d.numSteps * d.stepD * PLAN_SCALE;
    ctx.fillRect(p.x - sw / 2, p.y, sw, sl);
    ctx.strokeRect(p.x - sw / 2, p.y, sw, sl);
    // Steps
    for (let i = 0; i <= d.numSteps; i++) {
      const sy = p.y + i * d.stepD * PLAN_SCALE;
      ctx.beginPath(); ctx.moveTo(p.x - sw / 2, sy); ctx.lineTo(p.x + sw / 2, sy);
      ctx.lineWidth = 0.5; ctx.stroke();
    }
    // Arrow
    ctx.fillStyle = '#f97316'; ctx.font = '9px Inter'; ctx.textAlign = 'center';
    ctx.fillText('UP ↑', p.x, p.y + sl / 2);
    ctx.textAlign = 'left';
  });

  // Lights
  State.objects.filter(o => o.type === 'light' && o.floor === fl).forEach(o => {
    const p = toP(o.data.x, o.data.z);
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24'; ctx.fill(); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = '#fbbf2440'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Dimension arrows (overall plot dimensions)
  if (State.project) {
    const p0 = toP(0, 0);
    const pw = State.project.plotWidth * PLAN_SCALE;
    const ph = State.project.plotDepth * PLAN_SCALE;
    drawDimArrow(ctx, p0.x, p0.y - 20, p0.x + pw, p0.y - 20, `${State.project.plotWidth}m`);
    drawDimArrow(ctx, p0.x - 20, p0.y, p0.x - 20, p0.y + ph, `${State.project.plotDepth}m`, true);
  }

  // North arrow
  drawNorthArrow(ctx, canvas.width - 60, 100);
}

function drawDimArrow(ctx, x1, y1, x2, y2, label, vertical = false) {
  ctx.strokeStyle = '#0066cc'; ctx.lineWidth = 1; ctx.fillStyle = '#0066cc';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  // Arrowheads
  const arrowSize = 6;
  if (!vertical) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + arrowSize, y1 - 3); ctx.lineTo(x1 + arrowSize, y1 + 3); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - arrowSize, y2 - 3); ctx.lineTo(x2 - arrowSize, y2 + 3); ctx.closePath(); ctx.fill();
    ctx.font = '10px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillStyle = '#0066cc';
    ctx.fillText(label, (x1 + x2) / 2, y1 - 4);
  } else {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 3, y1 + arrowSize); ctx.lineTo(x1 + 3, y1 + arrowSize); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - 3, y2 - arrowSize); ctx.lineTo(x2 + 3, y2 - arrowSize); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(x1 - 8, (y1 + y2) / 2); ctx.rotate(-Math.PI / 2);
    ctx.font = '10px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillStyle = '#0066cc';
    ctx.fillText(label, 0, 0); ctx.restore();
  }
  ctx.textAlign = 'left';
}

function drawNorthArrow(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#333'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
  // Arrow
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(6, 8); ctx.lineTo(0, 4); ctx.lineTo(-6, 8); ctx.closePath();
  ctx.fillStyle = '#111'; ctx.fill(); ctx.stroke();
  ctx.font = 'bold 11px Inter'; ctx.textAlign = 'center'; ctx.fillStyle = '#111';
  ctx.fillText('N', 0, -24);
  ctx.restore();
}

function drawElevation(ctx, w, h, side) {
  ctx.fillStyle = '#f5f0e8'; ctx.fillRect(0, 0, w, h);
  if (!State.project) return;
  const ox = 80, oy = h - 80;
  const scale = PLAN_SCALE;
  const totalW = State.project.plotWidth * scale;
  const totalH = State.project.floors * State.project.floorHeight * scale;

  // Ground line
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(ox - 20, oy); ctx.lineTo(ox + totalW + 20, oy); ctx.stroke();

  // Floors
  for (let f = 0; f <= State.project.floors; f++) {
    const fy = oy - f * State.project.floorHeight * scale;
    ctx.strokeStyle = f === 0 ? '#333' : '#aaa'; ctx.lineWidth = f === 0 ? 1.5 : 0.75; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(ox, fy); ctx.lineTo(ox + totalW, fy); ctx.stroke();
    ctx.setLineDash([]);
    if (f > 0) {
      ctx.font = '9px JetBrains Mono'; ctx.fillStyle = '#666';
      ctx.fillText(`FL ${f}: +${(f * State.project.floorHeight).toFixed(2)}m`, ox + totalW + 4, fy + 3);
    }
  }

  // Outline box
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.setLineDash([]);
  ctx.strokeRect(ox, oy - totalH, totalW, totalH);

  // Walls from objects (simplified elevation)
  State.objects.filter(o => o.type === 'wall').forEach(o => {
    const d = o.data;
    const ex = ox + d.x1 * scale;
    const ey = oy - d.elev * scale;
    ctx.fillStyle = '#4a4a4a'; ctx.strokeStyle = '#222'; ctx.lineWidth = 0.5;
    ctx.fillRect(ex, ey - d.height * scale, d.length * scale, d.height * scale);
    ctx.strokeRect(ex, ey - d.height * scale, d.length * scale, d.height * scale);
  });

  // Windows
  State.objects.filter(o => o.type === 'window').forEach(o => {
    const d = o.data;
    const ex = ox + d.x * scale - (d.w / 2) * scale;
    const ey = oy - (d.elev + d.yOff + d.h) * scale;
    ctx.fillStyle = '#add8e680'; ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 1.5;
    ctx.fillRect(ex, ey, d.w * scale, d.h * scale);
    ctx.strokeRect(ex, ey, d.w * scale, d.h * scale);
  });

  // Doors
  State.objects.filter(o => o.type === 'door').forEach(o => {
    const d = o.data;
    const ex = ox + d.x * scale - (d.w / 2) * scale;
    const ey = oy - d.h * scale;
    ctx.fillStyle = '#7D5227'; ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5;
    ctx.fillRect(ex, ey, d.w * scale, d.h * scale);
    ctx.strokeRect(ex, ey, d.w * scale, d.h * scale);
  });

  // Height dimensions
  drawDimArrow(ctx, ox - 35, oy, ox - 35, oy - totalH, `${(State.project.floors * State.project.floorHeight).toFixed(1)}m`, true);
  drawDimArrow(ctx, ox, oy + 25, ox + totalW, oy + 25, `${State.project.plotWidth}m`);

  ctx.font = 'bold 13px Inter'; ctx.fillStyle = '#333'; ctx.textAlign = 'center';
  ctx.fillText('FRONT ELEVATION', w / 2, 40);
  ctx.textAlign = 'left';
}

function drawSection(ctx, w, h) {
  ctx.fillStyle = '#f5f0e8'; ctx.fillRect(0, 0, w, h);
  if (!State.project) return;
  const ox = 80, oy = h - 80;
  const scale = PLAN_SCALE;
  const totalD = State.project.plotDepth * scale;
  const totalH = State.project.floors * State.project.floorHeight * scale;

  ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(ox - 20, oy); ctx.lineTo(ox + totalD + 20, oy); ctx.stroke();
  ctx.strokeRect(ox, oy - totalH, totalD, totalH);

  // Slab lines
  for (let f = 0; f <= State.project.floors; f++) {
    const fy = oy - f * State.project.floorHeight * scale;
    const st = State.project.slabThickness * scale;
    ctx.fillStyle = '#9e9e9e'; ctx.fillRect(ox, fy - st, totalD, st);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 0.5;
    ctx.strokeRect(ox, fy - st, totalD, st);
    // Label
    ctx.font = '9px JetBrains Mono'; ctx.fillStyle = '#444';
    ctx.fillText(f === 0 ? 'Foundation Slab' : `Slab F${f} (${(State.project.slabThickness * 1000).toFixed(0)}mm)`, ox + totalD + 6, fy - st / 2 + 3);
  }

  // Section marker
  ctx.font = 'bold 13px Inter'; ctx.fillStyle = '#333'; ctx.textAlign = 'center';
  ctx.fillText('SECTION A-A', w / 2, 40);
  ctx.textAlign = 'left';
}

function drawTitleBlock(ctx, w, h, mode) {
  if (!State.project) return;
  const bw = 240, bh = 80;
  const bx = w - bw - 10, by = h - bh - 10;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeRect(bx, by, bw, bh);
  // Inner lines
  ctx.beginPath(); ctx.moveTo(bx, by + 20); ctx.lineTo(bx + bw, by + 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx, by + 40); ctx.lineTo(bx + bw, by + 40); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx + 120, by + 20); ctx.lineTo(bx + 120, by + 80); ctx.stroke();
  // Text
  ctx.font = 'bold 11px Inter'; ctx.fillStyle = '#111';
  ctx.fillText(State.project.name || 'Project', bx + 4, by + 14);
  ctx.font = '9px Inter'; ctx.fillStyle = '#555';
  ctx.fillText('Client: ' + (State.project.client || '—'), bx + 4, by + 34);
  ctx.fillText('Scale: 1:100', bx + 4, by + 52);
  ctx.fillText('Units: ' + State.project.units, bx + 4, by + 66);
  ctx.fillText('Date: ' + new Date().toLocaleDateString(), bx + 124, by + 34);
  ctx.fillText(mode.toUpperCase(), bx + 124, by + 52);
  ctx.fillText('Rev: A', bx + 124, by + 66);
}

// ═══════════════════════════════════════════════
// VIEWPORT CONTROLS
// ═══════════════════════════════════════════════
function fitView() {
  if (State.viewMode !== '3d') return;
  const pw = State.project ? State.project.plotWidth : 10;
  const pd = State.project ? State.project.plotDepth : 10;
  cameraTarget.set(pw / 2, 0, pd / 2);
  cameraRadius = Math.max(pw, pd) * 1.5 + 10;
  cameraPhi = Math.PI / 3;
  cameraTheta = Math.PI / 4;
  updateCameraFromSpherical();
}

function toggleGrid() {
  State.gridVisible = !State.gridVisible;
  gridHelper.visible = State.gridVisible;
  document.getElementById('vp-grid').classList.toggle('active', State.gridVisible);
}

function toggleWireframe() {
  State.wireframe = !State.wireframe;
  scene.traverse(obj => {
    if (obj.isMesh && obj !== groundPlane) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.wireframe = State.wireframe);
      else if (obj.material) obj.material.wireframe = State.wireframe;
    }
  });
  document.getElementById('vp-wireframe').classList.toggle('active', State.wireframe);
}

function toggleShadows() {
  State.shadowsEnabled = !State.shadowsEnabled;
  renderer.shadowMap.enabled = State.shadowsEnabled;
  document.getElementById('vp-shadow').classList.toggle('active', State.shadowsEnabled);
}

document.getElementById('vp-fit').addEventListener('click', fitView);
document.getElementById('vp-top').addEventListener('click', () => { cameraPhi = 0.02; updateCameraFromSpherical(); });
document.getElementById('vp-front').addEventListener('click', () => { cameraTheta = 0; cameraPhi = Math.PI / 2 - 0.05; updateCameraFromSpherical(); });
document.getElementById('vp-side').addEventListener('click', () => { cameraTheta = Math.PI / 2; cameraPhi = Math.PI / 2 - 0.05; updateCameraFromSpherical(); });
document.getElementById('vp-persp').addEventListener('click', () => { cameraPhi = Math.PI / 3; cameraTheta = Math.PI / 4; updateCameraFromSpherical(); });
document.getElementById('vp-wireframe').addEventListener('click', toggleWireframe);
document.getElementById('vp-grid').addEventListener('click', toggleGrid);
document.getElementById('vp-shadow').addEventListener('click', toggleShadows);

// ═══════════════════════════════════════════════
// UNDO / REDO
// ═══════════════════════════════════════════════
function pushHistory(action, obj) {
  State.history.push({ action, obj: JSON.parse(JSON.stringify({ id: obj.id, type: obj.type, data: obj.data, floor: obj.floor })) });
  State.future = [];
  if (State.history.length > 50) State.history.shift();
}

function undoAction() {
  if (!State.history.length) { showToast('Nothing to undo.'); return; }
  const last = State.history.pop();
  State.future.push(last);
  if (last.action === 'add') {
    const obj = State.objects.find(o => o.id === last.obj.id);
    if (obj) { scene.remove(obj.mesh); State.objects = State.objects.filter(o => o.id !== obj.id); }
    updateSchedule();
    showToast('Undo: removed last object.');
  }
  markDirty();
}

function redoAction() {
  if (!State.future.length) { showToast('Nothing to redo.'); return; }
  showToast('Redo not fully implemented yet.');
}

document.getElementById('btn-undo').addEventListener('click', undoAction);
document.getElementById('btn-redo').addEventListener('click', redoAction);

// ═══════════════════════════════════════════════
// PLOT OUTLINE
// ═══════════════════════════════════════════════
let plotOutline = null;
function drawPlotOutline() {
  if (plotOutline) scene.remove(plotOutline);
  if (!State.project) return;
  const pw = State.project.plotWidth, pd = State.project.plotDepth;
  const pts = [
    new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(pw, 0.02, 0),
    new THREE.Vector3(pw, 0.02, pd), new THREE.Vector3(0, 0.02, pd), new THREE.Vector3(0, 0.02, 0)
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 2 });
  plotOutline = new THREE.Line(geo, mat);
  scene.add(plotOutline);
}

// ═══════════════════════════════════════════════
// RENDER MODE
// ═══════════════════════════════════════════════
document.getElementById('btn-render').addEventListener('click', () => {
  State.renderMode = !State.renderMode;
  document.getElementById('btn-render').textContent = State.renderMode ? '✕ Exit Render' : '⚡ Render';
  if (State.renderMode) {
    renderer.toneMappingExposure = 1.8;
    scene.fog = null;
    showToast('Render mode ON — high quality view.', 'success');
  } else {
    renderer.toneMappingExposure = 1.2;
    scene.fog = new THREE.FogExp2(0x0a0e16, 0.012);
    showToast('Render mode OFF.');
  }
});

// ═══════════════════════════════════════════════
// SAVE / EXPORT
// ═══════════════════════════════════════════════
function saveProject() {
  if (!State.project) return;
  const saveData = {
    project: State.project,
    objects: State.objects.map(o => ({ id: o.id, type: o.type, floor: o.floor, name: o.name, data: o.data })),
    rooms: State.rooms.map(r => ({ ...r, mesh: undefined })),
    version: '1.0',
    savedAt: new Date().toISOString()
  };
  localStorage.setItem('archvision_save', JSON.stringify(saveData));
  State.dirty = false;
  document.getElementById('sb-saved').textContent = '● Saved';
  document.getElementById('sb-saved').classList.add('saved');
  showToast('Project saved locally.', 'success');
}

function loadSavedProject() {
  const raw = localStorage.getItem('archvision_save');
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    setupProject(data.project, false);
    // Re-build scene
    data.objects.forEach(o => {
      const d = o.data;
      if (o.type === 'wall' || o.type === 'partition') placeWall(d.x1, d.z1, d.x2, d.z2, d.elev, d.thickness, d.color, o.type);
      else if (o.type === 'column') placeColumn(d.x, d.z, d.elev);
      else if (o.type === 'stair') placeStair(d.x, d.z, d.elev);
      else if (o.type === 'door') placeDoorWindow(d.x, d.z, d.elev, 'door');
      else if (o.type === 'window') placeDoorWindow(d.x, d.z, d.elev, 'window');
      else if (o.type === 'light') placeLight(d.x, d.z, d.elev);
    });
    data.rooms && data.rooms.forEach(r => {
      r.mesh = null; State.rooms.push(r);
    });
    updateRoomsList(); updateSchedule();
    showToast('Project loaded from save.', 'success');
    return true;
  } catch (e) { console.error(e); return false; }
}

document.getElementById('btn-save').addEventListener('click', saveProject);

// Export dialog
document.getElementById('btn-export-pdf').addEventListener('click', () => document.getElementById('export-dialog').style.display = 'flex');
document.getElementById('close-export').addEventListener('click', () => document.getElementById('export-dialog').style.display = 'none');
document.getElementById('cancel-export').addEventListener('click', () => document.getElementById('export-dialog').style.display = 'none');
document.getElementById('confirm-export').addEventListener('click', doExport);

function doExport() {
  const selectedBtn = document.querySelector('.export-opt.selected') || document.getElementById('exp-png');
  exportPNG();
}

document.querySelectorAll('.export-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.export-opt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

document.getElementById('exp-png').addEventListener('click', exportPNG);
document.getElementById('exp-json').addEventListener('click', exportJSON);
document.getElementById('exp-pdf').addEventListener('click', exportPDF);

function exportPNG() {
  if (State.viewMode === '3d') {
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    download(url, 'archvision_3d.png');
  } else {
    const canvas = document.getElementById('plan-canvas');
    const url = canvas.toDataURL('image/png');
    download(url, 'archvision_plan.png');
  }
  showToast('PNG exported.', 'success');
  document.getElementById('export-dialog').style.display = 'none';
}

function exportJSON() {
  const data = {
    project: State.project,
    objects: State.objects.map(o => ({ id: o.id, type: o.type, floor: o.floor, name: o.name, data: o.data })),
    rooms: State.rooms.map(r => ({ ...r, mesh: undefined })),
    version: '1.0', exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  download(URL.createObjectURL(blob), 'archvision_project.json');
  showToast('JSON exported.', 'success');
  document.getElementById('export-dialog').style.display = 'none';
}

function exportPDF() {
  // Switch to 2D, capture canvas
  const prev = State.viewMode;
  setViewMode('2d'); renderPlan2D();
  setTimeout(() => {
    const canvas = document.getElementById('plan-canvas');
    const img = canvas.toDataURL('image/png');
    // Open print window
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>ArchVision Export</title>
    <style>body{margin:0;padding:0} img{width:100%;height:auto} @media print{body{margin:0}}</style></head>
    <body><img src="${img}" /></body></html>`);
    win.document.close(); win.focus();
    setTimeout(() => { win.print(); win.close(); }, 500);
    if (prev !== '2d') setViewMode(prev);
    document.getElementById('export-dialog').style.display = 'none';
    showToast('PDF print dialog opened.', 'success');
  }, 300);
}

function download(url, filename) {
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ═══════════════════════════════════════════════
// PROJECT SETUP
// ═══════════════════════════════════════════════
function setupProject(config, newScene = true) {
  State.project = config;
  State.currentFloor = 0;

  if (newScene) {
    State.objects.forEach(o => scene.remove(o.mesh));
    State.objects = [];
    State.rooms = [];
    State.history = [];
    State.future = [];
  }

  buildFloorTabs();
  drawPlotOutline();

  // Update project panel
  document.getElementById('proj-name-display').textContent = config.name;
  document.getElementById('rp-proj-name').textContent = config.name;
  document.getElementById('rp-proj-plot').textContent = `${config.plotWidth}×${config.plotDepth} m`;
  document.getElementById('rp-proj-floors').textContent = `${config.floors} (GF + ${config.floors - 1})`;
  document.getElementById('rp-proj-units').textContent = config.units;
  document.getElementById('units-display').textContent = config.units;

  // Camera
  fitView();
  updateSchedule();
  markDirty();
}

function markDirty() {
  State.dirty = true;
  document.getElementById('sb-saved').textContent = '● Unsaved';
  document.getElementById('sb-saved').classList.remove('saved');
}

// ═══════════════════════════════════════════════
// SAMPLE PROJECTS
// ═══════════════════════════════════════════════
function loadSampleVilla() {
  setupProject({
    name: '2-Story Villa', client: 'Sample Client', plotWidth: 15, plotDepth: 12,
    floors: 2, floorHeight: 3, wallThickness: 0.23, slabThickness: 0.15, units: 'm', north: 'N'
  });

  // Ground floor walls
  const walls = [
    [0, 0, 15, 0], [15, 0, 15, 12], [15, 12, 0, 12], [0, 12, 0, 0], // outer
    [5, 0, 5, 8], [5, 8, 10, 8], [10, 8, 10, 12], // partitions
    [0, 6, 5, 6], [10, 4, 15, 4],
  ];
  walls.forEach(([x1, z1, x2, z2]) => placeWall(x1, z1, x2, z2, 0, 0.23, 0xd4c5a9, 'wall'));

  // Columns at corners
  [[0.15, 0.15], [14.85, 0.15], [14.85, 11.85], [0.15, 11.85],
   [5, 0.15], [5, 8], [10, 8], [10, 4]].forEach(([x, z]) => placeColumn(x, z, 0));

  // Slab
  slabPoints.push({ x: 0, z: 0 });
  doSlabClick(15, 12, 0);

  // Doors
  placeDoorWindow(5, 0, 0, 'door');
  placeDoorWindow(5, 6, 0, 'door');
  placeDoorWindow(0, 6, 0, 'door');

  // Windows
  placeDoorWindow(3.5, 0, 0, 'window');
  placeDoorWindow(10, 0, 0, 'window');
  placeDoorWindow(15, 2, 0, 'window');
  placeDoorWindow(15, 8, 0, 'window');
  placeDoorWindow(7, 12, 0, 'window');

  // Stair
  placeStair(11.5, 2, 0);

  // Lights
  [[2.5, 3, 0], [7.5, 4, 0], [12.5, 2, 0], [12.5, 10, 0]].forEach(([x, z, e]) => placeLight(x, z, e));

  // Rooms
  roomFirstPt = { x: 0, z: 0 };
  doRoomClick(5, 6, 0); // Living
  State.rooms[State.rooms.length - 1].name = 'Living Room';

  roomFirstPt = { x: 5, z: 0 };
  doRoomClick(15, 4, 0);
  State.rooms[State.rooms.length - 1].name = 'Master Bedroom';

  roomFirstPt = { x: 0, z: 6 };
  doRoomClick(5, 12, 0);
  State.rooms[State.rooms.length - 1].name = 'Kitchen';

  roomFirstPt = { x: 5, z: 8 };
  doRoomClick(10, 12, 0);
  State.rooms[State.rooms.length - 1].name = 'Bathroom';

  roomFirstPt = { x: 10, z: 4 };
  doRoomClick(15, 12, 0);
  State.rooms[State.rooms.length - 1].name = 'Bedroom 2';

  // 1st floor – simpler
  const fh = 3;
  const walls2 = [[0, 0, 15, 0], [15, 0, 15, 12], [15, 12, 0, 12], [0, 12, 0, 0], [7, 0, 7, 12]];
  walls2.forEach(([x1, z1, x2, z2]) => { State.currentFloor = 1; placeWall(x1, z1, x2, z2, fh, 0.23, 0xd4c5a9, 'wall'); });
  State.currentFloor = 0;

  // 1st floor roof/balcony
  State.currentFloor = 1;
  placeBalcony(12, 0, 3);
  placeRoof(7, 6, 3);
  State.currentFloor = 0;

  updateSchedule(); updateRoomsList();
  showToast('Sample Villa loaded!', 'success');
}

function loadSampleApartment() {
  setupProject({
    name: 'Row House', client: 'Sample Client', plotWidth: 8, plotDepth: 20,
    floors: 2, floorHeight: 3, wallThickness: 0.23, slabThickness: 0.15, units: 'm', north: 'N'
  });

  // Outer walls
  [[0, 0, 8, 0], [8, 0, 8, 20], [8, 20, 0, 20], [0, 20, 0, 0]].forEach(([x1, z1, x2, z2]) => placeWall(x1, z1, x2, z2, 0, 0.23, 0xd4c5a9, 'wall'));

  // Partitions
  [[0, 7, 8, 7], [0, 14, 8, 14], [4, 7, 4, 14]].forEach(([x1, z1, x2, z2]) => placeWall(x1, z1, x2, z2, 0, 0.12, 0xb0b0b0, 'partition'));

  // Columns
  [[0.15, 0.15], [7.85, 0.15], [7.85, 19.85], [0.15, 19.85]].forEach(([x, z]) => placeColumn(x, z, 0));

  // Slab
  slabPoints.push({ x: 0, z: 0 });
  doSlabClick(8, 20, 0);

  // Doors & windows
  placeDoorWindow(4, 0, 0, 'door');
  placeDoorWindow(4, 7, 0, 'door');
  placeDoorWindow(2, 14, 0, 'door');
  placeDoorWindow(1.5, 0, 0, 'window');
  placeDoorWindow(6.5, 0, 0, 'window');
  placeDoorWindow(1.5, 20, 0, 'window');
  placeDoorWindow(6.5, 20, 0, 'window');

  placeStair(5.5, 10, 0);
  [[4, 3, 0], [2, 10, 0], [6, 10, 0], [4, 17, 0]].forEach(([x, z, e]) => placeLight(x, z, e));

  roomFirstPt = { x: 0, z: 0 }; doRoomClick(8, 7, 0); State.rooms[State.rooms.length - 1].name = 'Living Room';
  roomFirstPt = { x: 0, z: 7 }; doRoomClick(4, 14, 0); State.rooms[State.rooms.length - 1].name = 'Kitchen';
  roomFirstPt = { x: 4, z: 7 }; doRoomClick(8, 14, 0); State.rooms[State.rooms.length - 1].name = 'Bathroom';
  roomFirstPt = { x: 0, z: 14 }; doRoomClick(8, 20, 0); State.rooms[State.rooms.length - 1].name = 'Bedroom';

  // Some furniture
  const items = LibraryItems;
  placeBoxObject(items.find(i => i.name === 'Sofa 3-Seat'), 2, 3, 0);
  placeBoxObject(items.find(i => i.name === 'Dining Table'), 3, 5.5, 0);
  placeBoxObject(items.find(i => i.name === 'Double Bed'), 4, 16.5, 0);
  placeBoxObject(items.find(i => i.name === 'Toilet WC'), 4.5, 8, 0);
  placeBoxObject(items.find(i => i.name === 'Basin'), 5.5, 8.5, 0);

  updateSchedule(); updateRoomsList();
  showToast('Sample Row House loaded!', 'success');
}

// ═══════════════════════════════════════════════
// TOOL TAB SWITCHING
// ═══════════════════════════════════════════════
document.querySelectorAll('.pt-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.pt-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-content-${target}`).classList.add('active');
  });
});

// Tool buttons
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

// ═══════════════════════════════════════════════
// NEW PROJECT DIALOG
// ═══════════════════════════════════════════════
document.getElementById('btn-new-project').addEventListener('click', () => {
  document.getElementById('new-project-dialog').style.display = 'flex';
  document.getElementById('splash-screen').style.display = 'none';
  showApp();
});

document.getElementById('confirm-new-project').addEventListener('click', () => {
  const config = {
    name: document.getElementById('proj-name').value || 'My Project',
    client: document.getElementById('proj-client').value,
    plotWidth: parseFloat(document.getElementById('proj-plot-w').value) || 15,
    plotDepth: parseFloat(document.getElementById('proj-plot-d').value) || 12,
    floors: parseInt(document.getElementById('proj-floors').value) || 2,
    floorHeight: parseFloat(document.getElementById('proj-fh').value) || 3,
    wallThickness: parseFloat(document.getElementById('proj-wall-t').value) || 0.23,
    slabThickness: parseFloat(document.getElementById('proj-slab-t').value) || 0.15,
    units: document.getElementById('proj-units').value || 'm',
    north: document.getElementById('proj-north').value || 'N',
  };
  document.getElementById('new-project-dialog').style.display = 'none';
  setupProject(config);
  showToast(`Project "${config.name}" created!`, 'success');
});

['close-new-project', 'cancel-new-project'].forEach(id =>
  document.getElementById(id).addEventListener('click', () => {
    document.getElementById('new-project-dialog').style.display = 'none';
    document.getElementById('splash-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  })
);

// ═══════════════════════════════════════════════
// SPLASH ACTIONS
// ═══════════════════════════════════════════════
function showApp() {
  document.getElementById('splash-screen').style.display = 'none';
  document.getElementById('app').style.display = 'grid';
  setTimeout(() => { onResize(); fitView(); }, 100);
}

document.getElementById('btn-new-project').addEventListener('click', () => {
  showApp();
  document.getElementById('new-project-dialog').style.display = 'flex';
});

document.getElementById('btn-sample-villa').addEventListener('click', () => {
  showApp();
  setTimeout(loadSampleVilla, 200);
});

document.getElementById('btn-sample-apt').addEventListener('click', () => {
  showApp();
  setTimeout(loadSampleApartment, 200);
});

// ═══════════════════════════════════════════════
// TOAST HELPER
// ═══════════════════════════════════════════════
let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast' + (type ? ' ' + type : '');
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ═══════════════════════════════════════════════
// SNAP & GRID CONTROLS
// ═══════════════════════════════════════════════
document.getElementById('sb-snap').addEventListener('click', () => {
  State.snapEnabled = !State.snapEnabled;
  document.getElementById('sb-snap').textContent = `⊕ Snap ${State.snapEnabled ? 'ON' : 'OFF'}`;
});

// ═══════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════
(function init() {
  initScene();
  initLibrary();
  initLayers();
  setTool('select');

  // Try to restore a previous save
  // loadSavedProject(); // Disabled on first load; user must pick from splash

  // Keep 2D canvas pan-able
  const pc = document.getElementById('plan-canvas');
  let planDragging = false, planLastX = 0, planLastY = 0;
  pc.addEventListener('mousedown', e => { planDragging = true; planLastX = e.clientX; planLastY = e.clientY; });
  pc.addEventListener('mousemove', e => {
    if (!planDragging) return;
    plan2DOffset.x += e.clientX - planLastX;
    plan2DOffset.y += e.clientY - planLastY;
    planLastX = e.clientX; planLastY = e.clientY;
    renderPlan2D();
  });
  pc.addEventListener('mouseup', () => planDragging = false);
  pc.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const oldScale = PLAN_SCALE;
    PLAN_SCALE = Math.max(10, Math.min(120, PLAN_SCALE * zoomFactor));
    const mouseX = e.clientX - pc.getBoundingClientRect().left;
    const mouseY = e.clientY - pc.getBoundingClientRect().top;
    plan2DOffset.x = mouseX - (mouseX - plan2DOffset.x) * (PLAN_SCALE / oldScale);
    plan2DOffset.y = mouseY - (mouseY - plan2DOffset.y) * (PLAN_SCALE / oldScale);
    renderPlan2D();
  }, { passive: false });

  // Delete btn in properties
  document.getElementById('btn-delete-sel').addEventListener('click', deleteSelected);
  document.getElementById('btn-duplicate-sel').addEventListener('click', duplicateSelected);

  console.log('%c ArchVision Pro v1.0 ', 'background:#3b82f6;color:white;font-size:14px;font-weight:bold;padding:4px 8px;border-radius:4px');
  console.log('3D Architectural Design Platform for Civil Engineers');
})();
