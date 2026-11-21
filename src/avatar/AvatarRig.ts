import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { HANDSHAPES } from '../nsl/handshapes';
import type {
  ArmTarget,
  FacialExpressionSpec,
  HandshapeId,
  NslSignEntry,
  SignKeyframe,
  TranslationSignItem,
} from '../nsl/types';
import { NSL_BY_CODE, NSL_BY_GLOSS, REST_LEFT_ARM, REST_RIGHT_ARM } from '../nsl/vocabulary';

export type CameraPreset = 'waist_up' | 'full_body' | 'hands_closeup' | 'face_focus';

export interface QueuedSignPlayback {
  item: TranslationSignItem;
  sign: NslSignEntry;
}

export interface AvatarEngineCallbacks {
  onActiveSignChange?: (index: number, item: TranslationSignItem | null, sign: NslSignEntry | null) => void;
  onPlaybackStateChange?: (state: { isPlaying: boolean; isPaused: boolean; queueLength: number; activeIndex: number }) => void;
  onModelLoaded?: () => void;
  onError?: (message: string) => void;
}

const DEFAULT_HUMAN_GLB_URL = '/models/human_signer.glb';

const CAMERA_PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  waist_up: { pos: [0, 1.36, 1.46], target: [0, 1.26, 0.08] },
  full_body: { pos: [0, 1.12, 2.55], target: [0, 0.92, 0] },
  hands_closeup: { pos: [0, 1.24, 0.92], target: [0, 1.18, 0.2] },
  face_focus: { pos: [0, 1.56, 0.82], target: [0, 1.52, 0.04] },
};

const _euler = new THREE.Euler(0, 0, 0, 'XYZ');
const _qTemp = new THREE.Quaternion();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vDown = new THREE.Vector3(0, -1, 0);

const BONE_ALIASES: Record<string, string> = {
  hips: 'Hips',
  spine: 'Spine',
  spine1: 'Spine1',
  spine2: 'Chest',
  upperchest: 'Chest',
  chest: 'Chest',
  neck: 'Neck',
  head: 'Head',
  rightshoulder: 'RightShoulder',
  rightclavicle: 'RightShoulder',
  rightarm: 'RightArm',
  rightupperarm: 'RightArm',
  rightforearm: 'RightForeArm',
  rightlowerarm: 'RightForeArm',
  righthand: 'RightHand',
  leftshoulder: 'LeftShoulder',
  leftclavicle: 'LeftShoulder',
  leftarm: 'LeftArm',
  leftupperarm: 'LeftArm',
  leftforearm: 'LeftForeArm',
  leftlowerarm: 'LeftForeArm',
  lefthand: 'LeftHand',
  righthandthumb1: 'RightHandThumb1',
  righthandthumb2: 'RightHandThumb2',
  righthandthumb3: 'RightHandThumb3',
  righthandindex1: 'RightHandIndex1',
  righthandindex2: 'RightHandIndex2',
  righthandindex3: 'RightHandIndex3',
  righthandmiddle1: 'RightHandMiddle1',
  righthandmiddle2: 'RightHandMiddle2',
  righthandmiddle3: 'RightHandMiddle3',
  righthandring1: 'RightHandRing1',
  righthandring2: 'RightHandRing2',
  righthandring3: 'RightHandRing3',
  righthandpinky1: 'RightHandPinky1',
  righthandpinky2: 'RightHandPinky2',
  righthandpinky3: 'RightHandPinky3',
  lefthandthumb1: 'LeftHandThumb1',
  lefthandthumb2: 'LeftHandThumb2',
  lefthandthumb3: 'LeftHandThumb3',
  lefthandindex1: 'LeftHandIndex1',
  lefthandindex2: 'LeftHandIndex2',
  lefthandindex3: 'LeftHandIndex3',
  lefthandmiddle1: 'LeftHandMiddle1',
  lefthandmiddle2: 'LeftHandMiddle2',
  lefthandmiddle3: 'LeftHandMiddle3',
  lefthandring1: 'LeftHandRing1',
  lefthandring2: 'LeftHandRing2',
  lefthandring3: 'LeftHandRing3',
  lefthandpinky1: 'LeftHandPinky1',
  lefthandpinky2: 'LeftHandPinky2',
  lefthandpinky3: 'LeftHandPinky3',
};

function resolveCanonicalBoneName(rawName: string): string | null {
  const cleaned = rawName
    .replace(/^mixamorig[:_]?/i, '')
    .replace(/^Armature[:_]/i, '')
    .replace(/^CC_Base_/i, '')
    .replace(/[\s_.-]/g, '')
    .toLowerCase();
  return BONE_ALIASES[cleaned] ?? null;
}

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function createSkinTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#a06a4a');
  grad.addColorStop(0.5, '#945f40');
  grad.addColorStop(1, '#855336');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 3000; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(220, 165, 130, 0.04)' : 'rgba(65, 32, 18, 0.04)';
    ctx.fillRect(Math.abs(x) * 512, Math.abs(y) * 512, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function createFabricTexture(renderer: THREE.WebGLRenderer, baseHex: string, weaveHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = weaveHex;
  ctx.lineWidth = 1;
  for (let i = 0; i < 256; i += 4) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 124);
  grad.addColorStop(0, 'rgba(15, 23, 42, 0.36)');
  grad.addColorStop(0.55, 'rgba(15, 23, 42, 0.14)');
  grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createLimbLathe(topR: number, midR: number, botR: number, length: number, segments = 20): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(topR * 0.92, -length * 0.04),
    new THREE.Vector2(topR, -length * 0.14),
    new THREE.Vector2(midR, -length * 0.48),
    new THREE.Vector2(botR, -length * 0.88),
    new THREE.Vector2(botR * 0.86, -length * 0.97),
    new THREE.Vector2(0.001, -length),
  ];
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  return geo;
}

export class NslAvatarEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private isSoftwareGl: boolean;
  private callbacks: AvatarEngineCallbacks;

  private avatarRoot = new THREE.Group();
  private activeGlbGroup: THREE.Group | null = null;
  private proceduralGroup: THREE.Group | null = null;
  private bones = new Map<string, THREE.Bone>();

  private isGlbRig = false;
  private bindWorldQuat = new Map<string, THREE.Quaternion>();
  private bindLocalQuat = new Map<string, THREE.Quaternion>();
  private rightArmRestToDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  private leftArmRestToDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
  private morphMeshes: THREE.Mesh[] = [];

  private browNodes: { left: THREE.Object3D | null; right: THREE.Object3D | null; baseY: number } = {
    left: null,
    right: null,
    baseY: 0,
  };
  private jawGroup: THREE.Group | null = null;
  private leftEyelid: THREE.Mesh | null = null;
  private rightEyelid: THREE.Mesh | null = null;
  private mouthSmileBar: THREE.Mesh | null = null;

  private facialCurrent = { browRaise: 0, browFurrow: 0, smile: 0.18, mouthOpen: 0 };
  private facialTarget = { browRaise: 0, browFurrow: 0, smile: 0.18, mouthOpen: 0 };
  private blinkTimer = 0;
  private nextBlinkAt = 3.2;

  private mixer: THREE.AnimationMixer;
  private idleClip: THREE.AnimationClip;
  private idleAction: THREE.AnimationAction;
  private readyClip: THREE.AnimationClip;
  private readyAction: THREE.AnimationAction;
  private isListeningReady = false;
  private activeAction: THREE.AnimationAction | null = null;
  private clipCache = new Map<string, THREE.AnimationClip>();

  private queue: QueuedSignPlayback[] = [];
  private lastSequence: QueuedSignPlayback[] = [];
  private activeIndex = -1;
  private isPlaying = false;
  private isPaused = false;
  private speed = 1.0;
  private avatarScale = 1.0;

  private desiredCamPos = new THREE.Vector3(...CAMERA_PRESETS.waist_up.pos);
  private desiredCamTarget = new THREE.Vector3(...CAMERA_PRESETS.waist_up.target);
  private camTransitionActive = false;

  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(container: HTMLElement, callbacks: AvatarEngineCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 320);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.callbacks.onError?.('Graphics context was interrupted.');
    });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f1f4f8');
    this.scene.fog = new THREE.Fog('#f1f4f8', 6, 16);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    const envTex = pmrem.fromScene(roomEnv, 0.04).texture;
    this.scene.environment = envTex;
    roomEnv.dispose();
    pmrem.dispose();
    this.disposables.push(envTex);

    this.camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 40);
    this.camera.position.copy(this.desiredCamPos);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.desiredCamTarget);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 0.65;
    this.controls.maxDistance = 4.2;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = Math.PI * 0.56;
    this.controls.minAzimuthAngle = -Math.PI * 0.48;
    this.controls.maxAzimuthAngle = Math.PI * 0.48;
    this.controls.addEventListener('start', () => {
      this.camTransitionActive = false;
    });
    this.controls.update();

    this.setupLightingAndStage();
    this.scene.add(this.avatarRoot);

    this.mixer = new THREE.AnimationMixer(this.avatarRoot);
    this.idleClip = new THREE.AnimationClip('EMPTY_INIT', 1, []);
    this.idleAction = this.mixer.clipAction(this.idleClip);
    this.readyClip = new THREE.AnimationClip('EMPTY_READY', 1, []);
    this.readyAction = this.mixer.clipAction(this.readyClip);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.clock.start();
    this.tick();

    void this.initAvatar();
  }

  private async initAvatar() {
    try {
      await MeshoptDecoder.ready;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(DEFAULT_HUMAN_GLB_URL);
      if (this.disposed) return;
      this.bindGlbScene(gltf.scene);
    } catch {
      if (this.disposed) return;
      this.buildProceduralElderlySigner();
      this.resetMixer(this.avatarRoot);
      this.callbacks.onModelLoaded?.();
    }
  }

  public setCallbacks(callbacks: AvatarEngineCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  private setupLightingAndStage() {
    const hemi = new THREE.HemisphereLight('#f8fafc', '#94a3b8', 0.85);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff6ec', 2.0);
    keyLight.position.set(2.1, 3.3, 2.8);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 10;
    keyLight.shadow.camera.left = -1.6;
    keyLight.shadow.camera.right = 1.6;
    keyLight.shadow.camera.top = 2.4;
    keyLight.shadow.camera.bottom = -0.2;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight('#e2efff', 0.9);
    fillLight.position.set(-2.3, 2.0, 2.2);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight('#ffffff', 0.85);
    rimLight.position.set(0.2, 2.6, -2.4);
    this.scene.add(rimLight);

    const floorGeo = new THREE.CircleGeometry(9, 48);
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#e8edf3',
      roughness: 0.92,
      metalness: 0.0,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.disposables.push(floorGeo, floorMat);

    const shadowTex = createContactShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(1.1, 1.1);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.45,
    });
    const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.004;
    this.scene.add(contactShadow);
    this.disposables.push(shadowTex, shadowGeo, shadowMat);
  }

  private resetMixer(targetRoot: THREE.Object3D) {
    this.mixer.stopAllAction();
    this.clipCache.clear();
    this.activeAction = null;
    this.queue = [];
    this.activeIndex = -1;
    this.isPlaying = false;
    this.isPaused = false;

    this.mixer = new THREE.AnimationMixer(targetRoot);
    this.idleClip = this.createIdleClip();
    this.idleAction = this.mixer.clipAction(this.idleClip);
    this.readyClip = this.createReadyClip();
    this.readyAction = this.mixer.clipAction(this.readyClip);
    if (this.isListeningReady) {
      this.readyAction.play();
    } else {
      this.idleAction.play();
    }

    this.mixer.addEventListener('finished', (event) => {
      if (event.action === this.activeAction && this.isPlaying && !this.isPaused) {
        this.advanceQueue();
      }
    });
  }

  private bindGlbScene(model: THREE.Group) {
    if (this.activeGlbGroup) {
      this.avatarRoot.remove(this.activeGlbGroup);
      this.activeGlbGroup = null;
    }
    if (this.proceduralGroup) {
      this.proceduralGroup.visible = false;
    }

    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scaleFactor = size.y > 0.01 ? 1.70 / size.y : 1;
    model.scale.multiplyScalar(scaleFactor);
    model.updateMatrixWorld(true);

    const scaledBox = new THREE.Box3().setFromObject(model);
    model.position.y -= scaledBox.min.y;
    model.updateMatrixWorld(true);

    this.isGlbRig = true;
    this.bones.clear();
    this.bindWorldQuat.clear();
    this.bindLocalQuat.clear();
    this.morphMeshes = [];

    const bindWorldPos = new Map<string, THREE.Vector3>();

    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          this.morphMeshes.push(mesh);
        }

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if (std && std.isMeshStandardMaterial) {
            std.metalness = Math.min(std.metalness, 0.04);
            std.roughness = Math.max(std.roughness, 0.72);
            std.envMapIntensity = 0.55;
            std.needsUpdate = true;
          }
        }
      }

      const bone = obj as THREE.Bone;
      if (bone.isBone) {
        const canonical = resolveCanonicalBoneName(bone.name);
        if (canonical && !this.bones.has(canonical)) {
          bone.name = canonical;
          this.bones.set(canonical, bone);

          const wq = new THREE.Quaternion();
          bone.getWorldQuaternion(wq);
          this.bindWorldQuat.set(canonical, wq);
          this.bindLocalQuat.set(canonical, bone.quaternion.clone());

          const wp = new THREE.Vector3();
          bone.getWorldPosition(wp);
          bindWorldPos.set(canonical, wp);
        }
      }
    });

    const rArmP = bindWorldPos.get('RightArm');
    const rForeP = bindWorldPos.get('RightForeArm');
    if (rArmP && rForeP) {
      _vA.subVectors(rForeP, rArmP).normalize();
      this.rightArmRestToDown.setFromUnitVectors(_vA, _vDown);
    } else {
      this.rightArmRestToDown.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    }

    const lArmP = bindWorldPos.get('LeftArm');
    const lForeP = bindWorldPos.get('LeftForeArm');
    if (lArmP && lForeP) {
      _vB.subVectors(lForeP, lArmP).normalize();
      this.leftArmRestToDown.setFromUnitVectors(_vB, _vDown);
    } else {
      this.leftArmRestToDown.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
    }

    this.attachElderlyGentlemanFeatures(model);

    this.activeGlbGroup = model;
    this.avatarRoot.add(model);

    this.applyPoseImmediate('Right', REST_RIGHT_ARM, 'RELAXED');
    this.applyPoseImmediate('Left', REST_LEFT_ARM, 'RELAXED');

    this.resetMixer(model);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.callbacks.onModelLoaded?.();
  }

  /**
   * Builds and attaches the blue hat, eyeglasses, silver hair/sideburns,
   * mustache, and articulated silver eyebrows directly onto the Head bone
   * using exact world-space measurements from LeftEye, RightEye, Head, and HeadEnd.
   */
  private attachElderlyGentlemanFeatures(model: THREE.Group) {
    const headBone = this.bones.get('Head') ?? model.getObjectByName('Head');
    if (!headBone) return;

    model.updateMatrixWorld(true);
    const leftEyeObj = model.getObjectByName('LeftEye');
    const rightEyeObj = model.getObjectByName('RightEye');
    const headEndObj = model.getObjectByName('HeadEnd');

    const headWorld = new THREE.Vector3();
    headBone.getWorldPosition(headWorld);

    const leftEyePos = new THREE.Vector3(headWorld.x + 0.031, headWorld.y + 0.055, headWorld.z + 0.068);
    const rightEyePos = new THREE.Vector3(headWorld.x - 0.031, headWorld.y + 0.055, headWorld.z + 0.068);
    if (leftEyeObj) leftEyeObj.getWorldPosition(leftEyePos);
    if (rightEyeObj) rightEyeObj.getWorldPosition(rightEyePos);

    const headTopPos = new THREE.Vector3(headWorld.x, headWorld.y + 0.19, headWorld.z);
    if (headEndObj) headEndObj.getWorldPosition(headTopPos);

    const eyeMid = new THREE.Vector3().addVectors(leftEyePos, rightEyePos).multiplyScalar(0.5);
    const eyeDist = Math.max(0.052, leftEyePos.distanceTo(rightEyePos));

    const accessoryGroup = new THREE.Group();
    accessoryGroup.name = 'ElderlyGentlemanFeatures';

    const hatTex = createFabricTexture(this.renderer, '#224c8c', '#1a3c70');
    const hatMat = new THREE.MeshPhysicalMaterial({
      map: hatTex,
      roughness: 0.86,
      metalness: 0.02,
      sheen: 0.32,
      sheenRoughness: 0.78,
      sheenColor: new THREE.Color('#60a5fa'),
    });
    const hatBandMat = new THREE.MeshStandardMaterial({
      color: '#13284b',
      roughness: 0.72,
      metalness: 0.04,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: '#2c1e16',
      roughness: 0.34,
      metalness: 0.22,
    });
    const lensMat = new THREE.MeshPhysicalMaterial({
      color: '#f8fafc',
      roughness: 0.05,
      metalness: 0.0,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const silverHairMat = new THREE.MeshStandardMaterial({
      color: '#d4d8df',
      roughness: 0.85,
      metalness: 0.02,
    });

    this.disposables.push(hatTex, hatMat, hatBandMat, frameMat, lensMat, silverHairMat);

    // 1. Classic Blue Hat (fedora/trilby silhouette with textured felt crown, band, and gently curved brim)
    const hatGroup = new THREE.Group();
    const hatBaseY = eyeMid.y + eyeDist * 0.66;
    const crownHeight = Math.max(0.095, headTopPos.y - hatBaseY + 0.028);

    const hatProfile = [
      new THREE.Vector2(0.001, crownHeight),
      new THREE.Vector2(0.072, crownHeight * 0.96),
      new THREE.Vector2(0.088, crownHeight * 0.68),
      new THREE.Vector2(0.096, crownHeight * 0.14),
      new THREE.Vector2(0.098, 0.006),
      new THREE.Vector2(0.142, -0.008),
      new THREE.Vector2(0.148, -0.012),
      new THREE.Vector2(0.095, -0.002),
    ];
    const hatGeo = new THREE.LatheGeometry(hatProfile, 36);
    hatGeo.computeVertexNormals();
    const hatMesh = new THREE.Mesh(hatGeo, hatMat);
    hatMesh.scale.set(0.95, 1.0, 1.12);
    hatMesh.castShadow = true;
    hatMesh.receiveShadow = true;
    hatGroup.add(hatMesh);
    this.disposables.push(hatGeo);

    const bandGeo = new THREE.CylinderGeometry(0.095, 0.098, 0.02, 36);
    const bandMesh = new THREE.Mesh(bandGeo, hatBandMat);
    bandMesh.position.y = 0.013;
    bandMesh.scale.set(0.955, 1.0, 1.125);
    hatGroup.add(bandMesh);
    this.disposables.push(bandGeo);

    hatGroup.position.set(headTopPos.x, hatBaseY, headTopPos.z + 0.006);
    hatGroup.rotation.x = -0.11;
    accessoryGroup.add(hatGroup);

    // 2. Classic Eyeglasses positioned on the nose bridge centered between LeftEye & RightEye
    const glassesGroup = new THREE.Group();
    const lensRadius = eyeDist * 0.285;
    const glassZ = eyeMid.z + eyeDist * 0.36;
    const glassY = eyeMid.y - eyeDist * 0.03;

    const rimGeo = new THREE.TorusGeometry(lensRadius, 0.0019, 12, 32);
    const lensGeo = new THREE.CircleGeometry(lensRadius * 0.96, 28);
    const templeGeo = new THREE.CylinderGeometry(0.0015, 0.0013, eyeDist * 1.45, 8);
    this.disposables.push(rimGeo, lensGeo, templeGeo);

    ([-1, 1] as const).forEach((s) => {
      const rx = eyeMid.x + s * (eyeDist * 0.5);

      const rim = new THREE.Mesh(rimGeo, frameMat);
      rim.position.set(rx, glassY, glassZ);
      rim.scale.set(1.06, 0.94, 1);
      rim.castShadow = true;
      glassesGroup.add(rim);

      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.set(rx, glassY, glassZ - 0.0005);
      lens.scale.set(1.04, 0.92, 1);
      glassesGroup.add(lens);

      const temple = new THREE.Mesh(templeGeo, frameMat);
      temple.rotation.x = Math.PI / 2;
      temple.rotation.z = -s * 0.08;
      temple.position.set(rx + s * (lensRadius * 1.02), glassY + 0.003, glassZ - eyeDist * 0.72);
      glassesGroup.add(temple);
    });

    const bridgeGeo = new THREE.TorusGeometry(eyeDist * 0.12, 0.0018, 10, 16, Math.PI);
    const bridge = new THREE.Mesh(bridgeGeo, frameMat);
    bridge.position.set(eyeMid.x, glassY + 0.002, glassZ);
    glassesGroup.add(bridge);
    this.disposables.push(bridgeGeo);

    accessoryGroup.add(glassesGroup);

    // 3. Elderly Silver Hair Fringe, Sideburns, Mustache & Dynamic Silver Brows
    const hairFringeGeo = new THREE.TorusGeometry(0.082, 0.016, 12, 28, Math.PI * 1.28);
    const hairFringe = new THREE.Mesh(hairFringeGeo, silverHairMat);
    hairFringe.rotation.x = Math.PI / 2;
    hairFringe.rotation.z = Math.PI * 0.86;
    hairFringe.position.set(headTopPos.x, hatBaseY - 0.015, headTopPos.z - 0.004);
    hairFringe.scale.set(0.95, 1.1, 1.15);
    accessoryGroup.add(hairFringe);
    this.disposables.push(hairFringeGeo);

    const sideburnGeo = new THREE.CapsuleGeometry(0.006, 0.028, 6, 10);
    this.disposables.push(sideburnGeo);
    ([-1, 1] as const).forEach((s) => {
      const sb = new THREE.Mesh(sideburnGeo, silverHairMat);
      sb.position.set(eyeMid.x + s * (eyeDist * 1.12), eyeMid.y - 0.018, eyeMid.z - eyeDist * 0.78);
      sb.rotation.x = 0.14;
      accessoryGroup.add(sb);
    });

    // Sculpted gentleman's silver mustache resting cleanly above upper lip
    const stacheGeo = new THREE.CapsuleGeometry(0.0052, 0.015, 6, 12);
    this.disposables.push(stacheGeo);
    ([-1, 1] as const).forEach((s) => {
      const wing = new THREE.Mesh(stacheGeo, silverHairMat);
      wing.position.set(eyeMid.x + s * 0.012, eyeMid.y - eyeDist * 0.64, eyeMid.z + eyeDist * 0.18);
      wing.rotation.z = Math.PI / 2 - s * 0.24;
      wing.rotation.y = -s * 0.28;
      accessoryGroup.add(wing);
    });

    // Dynamic silver eyebrows aligned just above the frames
    const browGeo = new THREE.CapsuleGeometry(0.0038, 0.022, 6, 10);
    this.disposables.push(browGeo);
    const browBaseY = eyeMid.y + eyeDist * 0.34;

    const leftBrowGrp = new THREE.Group();
    leftBrowGrp.position.set(eyeMid.x + eyeDist * 0.48, browBaseY, eyeMid.z + eyeDist * 0.22);
    const lbMesh = new THREE.Mesh(browGeo, silverHairMat);
    lbMesh.rotation.z = Math.PI / 2 - 0.08;
    leftBrowGrp.add(lbMesh);
    accessoryGroup.add(leftBrowGrp);

    const rightBrowGrp = new THREE.Group();
    rightBrowGrp.position.set(eyeMid.x - eyeDist * 0.48, browBaseY, eyeMid.z + eyeDist * 0.22);
    const rbMesh = new THREE.Mesh(browGeo, silverHairMat);
    rbMesh.rotation.z = Math.PI / 2 + 0.08;
    rightBrowGrp.add(rbMesh);
    accessoryGroup.add(rightBrowGrp);

    this.scene.add(accessoryGroup);
    accessoryGroup.updateMatrixWorld(true);
    headBone.attach(accessoryGroup);

    this.browNodes = {
      left: leftBrowGrp,
      right: rightBrowGrp,
      baseY: leftBrowGrp.position.y,
    };
  }

  private createBone(name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Bone {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    parent.add(bone);
    this.bones.set(name, bone);
    return bone;
  }

  private buildProceduralElderlySigner() {
    this.isGlbRig = false;
    this.bindWorldQuat.clear();
    this.bindLocalQuat.clear();
    this.morphMeshes = [];

    if (this.proceduralGroup) {
      this.proceduralGroup.visible = true;
      this.bones.clear();
      this.proceduralGroup.traverse((obj) => {
        if ((obj as THREE.Bone).isBone) {
          this.bones.set(obj.name, obj as THREE.Bone);
        }
      });
      this.applyPoseImmediate('Right', REST_RIGHT_ARM, 'RELAXED');
      this.applyPoseImmediate('Left', REST_LEFT_ARM, 'RELAXED');
      return;
    }

    const group = new THREE.Group();
    this.proceduralGroup = group;
    this.bones.clear();

    const skinTex = createSkinTexture(this.renderer);
    const cardiganTex = createFabricTexture(this.renderer, '#2c415e', '#23354e');
    const hatTex = createFabricTexture(this.renderer, '#224c8c', '#1a3c70');
    const shirtTex = createFabricTexture(this.renderer, '#f1f5f9', '#e2e8f0');
    const trouserTex = createFabricTexture(this.renderer, '#2b303a', '#1f232b');

    const skinMat = new THREE.MeshPhysicalMaterial({
      map: skinTex,
      roughness: 0.65,
      metalness: 0.02,
      clearcoat: 0.04,
      clearcoatRoughness: 0.75,
    });
    const cardiganMat = new THREE.MeshPhysicalMaterial({
      map: cardiganTex,
      roughness: 0.86,
      metalness: 0.02,
      sheen: 0.3,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color('#93c5fd'),
    });
    const hatMat = new THREE.MeshPhysicalMaterial({
      map: hatTex,
      roughness: 0.86,
      metalness: 0.02,
      sheen: 0.32,
      sheenColor: new THREE.Color('#60a5fa'),
    });
    const shirtMat = new THREE.MeshStandardMaterial({ map: shirtTex, roughness: 0.78 });
    const trouserMat = new THREE.MeshStandardMaterial({ map: trouserTex, roughness: 0.86 });
    const silverHairMat = new THREE.MeshStandardMaterial({ color: '#d4d8df', roughness: 0.85 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#2c1e16', roughness: 0.34, metalness: 0.22 });
    const lensMat = new THREE.MeshPhysicalMaterial({
      color: '#f8fafc',
      roughness: 0.05,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const shoeMat = new THREE.MeshStandardMaterial({ color: '#1e1b18', roughness: 0.42, metalness: 0.12 });
    const lipMat = new THREE.MeshStandardMaterial({ color: '#78483c', roughness: 0.58 });
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.22 });
    const irisMat = new THREE.MeshStandardMaterial({ color: '#2b1b12', roughness: 0.15 });

    this.disposables.push(
      skinTex, cardiganTex, hatTex, shirtTex, trouserTex,
      skinMat, cardiganMat, hatMat, shirtMat, trouserMat,
      silverHairMat, frameMat, lensMat, shoeMat, lipMat, eyeWhiteMat, irisMat
    );

    const addPart = (
      parent: THREE.Object3D,
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      pos: [number, number, number] = [0, 0, 0],
      scale?: [number, number, number]
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      if (scale) m.scale.set(...scale);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      this.disposables.push(geo);
      return m;
    };

    const hips = this.createBone('Hips', group, 0, 0.96, 0);
    addPart(hips, new THREE.CylinderGeometry(0.145, 0.138, 0.16, 24), trouserMat, [0, -0.02, 0], [1.05, 1, 0.72]);

    (['Right', 'Left'] as const).forEach((side) => {
      const sign = side === 'Right' ? -1 : 1;
      const upLeg = this.createBone(`${side}UpLeg`, hips, sign * 0.095, -0.06, 0);
      addPart(upLeg, createLimbLathe(0.082, 0.068, 0.056, 0.42), trouserMat, [0, 0, 0], [1, 1, 0.95]);
      const leg = this.createBone(`${side}Leg`, upLeg, 0, -0.42, 0);
      addPart(leg, createLimbLathe(0.055, 0.05, 0.038, 0.4), trouserMat);
      const foot = this.createBone(`${side}Foot`, leg, 0, -0.4, 0.01);
      const shoe = addPart(foot, new THREE.CapsuleGeometry(0.044, 0.11, 8, 16), shoeMat, [0, -0.04, 0.055]);
      shoe.rotation.x = Math.PI / 2;
      shoe.scale.set(1.0, 1.0, 0.78);
    });

    const spine = this.createBone('Spine', hips, 0, 0.1, 0);
    addPart(spine, new THREE.CylinderGeometry(0.138, 0.135, 0.16, 24), cardiganMat, [0, 0.05, 0], [1.06, 1, 0.74]);
    const spine1 = this.createBone('Spine1', spine, 0, 0.13, 0);
    addPart(spine1, new THREE.CylinderGeometry(0.156, 0.138, 0.16, 24), cardiganMat, [0, 0.05, 0], [1.1, 1, 0.74]);
    const chest = this.createBone('Chest', spine1, 0, 0.14, 0);
    addPart(chest, new THREE.CylinderGeometry(0.172, 0.156, 0.17, 24), cardiganMat, [0, 0.05, 0], [1.14, 1, 0.7]);
    addPart(chest, new THREE.CylinderGeometry(0.062, 0.03, 0.15, 16), shirtMat, [0, 0.06, 0.084], [1.1, 1, 0.35]);
    addPart(chest, new THREE.CapsuleGeometry(0.072, 0.28, 8, 20), cardiganMat, [0, 0.11, 0], [1, 1, 0.76]).rotation.z = Math.PI / 2;

    const neck = this.createBone('Neck', chest, 0, 0.17, 0);
    addPart(neck, new THREE.CylinderGeometry(0.048, 0.056, 0.11, 20), skinMat, [0, 0.04, 0]);
    const collar = addPart(neck, new THREE.TorusGeometry(0.058, 0.014, 10, 24), shirtMat, [0, 0.005, 0.006]);
    collar.rotation.x = Math.PI / 2 + 0.18;

    const head = this.createBone('Head', neck, 0, 0.09, 0);
    const headProfile = [
      new THREE.Vector2(0.001, -0.025),
      new THREE.Vector2(0.052, -0.012),
      new THREE.Vector2(0.076, 0.025),
      new THREE.Vector2(0.088, 0.075),
      new THREE.Vector2(0.086, 0.125),
      new THREE.Vector2(0.066, 0.165),
      new THREE.Vector2(0.001, 0.182),
    ];
    addPart(head, new THREE.LatheGeometry(headProfile, 28), skinMat, [0, 0, 0.01], [0.94, 1.0, 1.06]);
    addPart(head, new THREE.SphereGeometry(0.089, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.56), silverHairMat, [0, 0.082, -0.002], [0.95, 1.05, 1.07]);

    // Blue Hat
    const hatProfile = [
      new THREE.Vector2(0.001, 0.1),
      new THREE.Vector2(0.072, 0.095),
      new THREE.Vector2(0.088, 0.068),
      new THREE.Vector2(0.095, 0.012),
      new THREE.Vector2(0.145, -0.008),
      new THREE.Vector2(0.095, -0.002),
    ];
    const hat = addPart(head, new THREE.LatheGeometry(hatProfile, 32), hatMat, [0, 0.125, -0.002], [0.95, 1, 1.08]);
    hat.rotation.x = -0.1;

    const earGeo = new THREE.SphereGeometry(0.018, 12, 12);
    addPart(head, earGeo, skinMat, [-0.082, 0.065, -0.005], [0.45, 1.15, 0.72]);
    addPart(head, earGeo.clone(), skinMat, [0.082, 0.065, -0.005], [0.45, 1.15, 0.72]);

    const noseBridge = addPart(head, new THREE.CapsuleGeometry(0.011, 0.026, 6, 12), skinMat, [0, 0.066, 0.095]);
    noseBridge.rotation.x = -0.22;
    addPart(head, new THREE.SphereGeometry(0.013, 12, 12), skinMat, [0, 0.05, 0.101], [1.15, 0.85, 0.9]);

    ([-1, 1] as const).forEach((sideSign) => {
      const ex = sideSign * 0.031;
      addPart(head, new THREE.SphereGeometry(0.013, 14, 14), eyeWhiteMat, [ex, 0.084, 0.086], [1.05, 0.82, 0.65]);
      addPart(head, new THREE.SphereGeometry(0.0072, 12, 12), irisMat, [ex, 0.084, 0.092], [1, 1, 0.5]);

      const lid = addPart(head, new THREE.SphereGeometry(0.0142, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), skinMat, [ex, 0.086, 0.086], [1.06, 0.86, 0.7]);
      lid.rotation.x = -0.9;
      if (sideSign < 0) this.rightEyelid = lid;
      else this.leftEyelid = lid;

      addPart(head, new THREE.TorusGeometry(0.02, 0.0022, 10, 28), frameMat, [ex, 0.084, 0.106]);
      addPart(head, new THREE.CircleGeometry(0.019, 24), lensMat, [ex, 0.084, 0.105]);
    });
    addPart(head, new THREE.TorusGeometry(0.009, 0.002, 8, 14, Math.PI), frameMat, [0, 0.085, 0.106]);

    // Silver mustache & brows
    ([-1, 1] as const).forEach((s) => {
      const w = addPart(head, new THREE.CapsuleGeometry(0.0052, 0.016, 6, 10), silverHairMat, [s * 0.012, 0.037, 0.095]);
      w.rotation.z = Math.PI / 2 - s * 0.24;
    });

    const browGeo = new THREE.CapsuleGeometry(0.0044, 0.024, 6, 10);
    const rightBrowGrp = new THREE.Group();
    rightBrowGrp.position.set(-0.031, 0.108, 0.094);
    addPart(rightBrowGrp, browGeo, silverHairMat).rotation.z = Math.PI / 2;
    head.add(rightBrowGrp);

    const leftBrowGrp = new THREE.Group();
    leftBrowGrp.position.set(0.031, 0.108, 0.094);
    addPart(leftBrowGrp, browGeo.clone(), silverHairMat).rotation.z = Math.PI / 2;
    head.add(leftBrowGrp);

    this.browNodes = { left: leftBrowGrp, right: rightBrowGrp, baseY: 0.108 };

    const jawGrp = new THREE.Group();
    jawGrp.position.set(0, 0.032, 0.032);
    head.add(jawGrp);
    this.jawGroup = jawGrp;

    addPart(head, new THREE.CapsuleGeometry(0.0046, 0.024, 6, 12), lipMat, [0, 0.026, 0.093]).rotation.z = Math.PI / 2;
    const lowerLip = addPart(jawGrp, new THREE.CapsuleGeometry(0.005, 0.022, 6, 12), lipMat, [0, -0.012, 0.06], [1, 1, 0.9]);
    lowerLip.rotation.z = Math.PI / 2;
    this.mouthSmileBar = lowerLip;

    (['Right', 'Left'] as const).forEach((side) => {
      const s = side === 'Right' ? -1 : 1;
      const shoulder = this.createBone(`${side}Shoulder`, chest, s * 0.185, 0.115, 0);
      addPart(shoulder, new THREE.SphereGeometry(0.058, 16, 16), cardiganMat, [0, -0.01, 0]);

      const arm = this.createBone(`${side}Arm`, shoulder, 0, 0, 0);
      addPart(arm, createLimbLathe(0.056, 0.048, 0.044, 0.28), cardiganMat);

      const forearm = this.createBone(`${side}ForeArm`, arm, 0, -0.28, 0);
      addPart(forearm, createLimbLathe(0.043, 0.038, 0.032, 0.095), cardiganMat);
      addPart(forearm, createLimbLathe(0.036, 0.032, 0.026, 0.25), skinMat);

      const hand = this.createBone(`${side}Hand`, forearm, 0, -0.25, 0);
      addPart(hand, new THREE.BoxGeometry(0.024, 0.086, 0.072), skinMat, [0, -0.043, 0.004]);
      addPart(hand, new THREE.SphereGeometry(0.016, 12, 12), skinMat, [s * -0.003, -0.025, 0.02], [0.85, 1.4, 1.0]);
      addPart(hand, new THREE.CapsuleGeometry(0.012, 0.055, 6, 12), skinMat, [0, -0.084, 0.004]).rotation.x = Math.PI / 2;

      const fingerSpecs = [
        { name: 'Index', zOff: 0.028, yOff: -0.086, len: [0.038, 0.026, 0.02], r: 0.0086 },
        { name: 'Middle', zOff: 0.01, yOff: -0.088, len: [0.042, 0.029, 0.021], r: 0.0088 },
        { name: 'Ring', zOff: -0.009, yOff: -0.086, len: [0.038, 0.026, 0.019], r: 0.0084 },
        { name: 'Pinky', zOff: -0.027, yOff: -0.081, len: [0.03, 0.021, 0.016], r: 0.0074 },
      ] as const;

      fingerSpecs.forEach((f) => {
        const b1 = this.createBone(`${side}Hand${f.name}1`, hand, 0, f.yOff, f.zOff);
        addPart(b1, new THREE.SphereGeometry(f.r * 1.05, 10, 10), skinMat);
        addPart(b1, createLimbLathe(f.r, f.r * 0.92, f.r * 0.84, f.len[0], 12), skinMat);

        const b2 = this.createBone(`${side}Hand${f.name}2`, b1, 0, -f.len[0], 0);
        addPart(b2, new THREE.SphereGeometry(f.r * 0.9, 10, 10), skinMat);
        addPart(b2, createLimbLathe(f.r * 0.86, f.r * 0.8, f.r * 0.74, f.len[1], 12), skinMat);

        const b3 = this.createBone(`${side}Hand${f.name}3`, b2, 0, -f.len[1], 0);
        addPart(b3, createLimbLathe(f.r * 0.76, f.r * 0.68, f.r * 0.56, f.len[2], 12), skinMat);
      });

      const t1 = this.createBone(`${side}HandThumb1`, hand, -s * 0.008, -0.026, 0.036);
      t1.rotation.set(0.45, 0, -s * 0.32);
      addPart(t1, createLimbLathe(0.011, 0.01, 0.009, 0.032, 12), skinMat);

      const t2 = this.createBone(`${side}HandThumb2`, t1, 0, -0.032, 0);
      addPart(t2, new THREE.SphereGeometry(0.0095, 10, 10), skinMat);
      addPart(t2, createLimbLathe(0.0092, 0.0085, 0.0076, 0.026, 12), skinMat);

      const t3 = this.createBone(`${side}HandThumb3`, t2, 0, -0.026, 0);
      addPart(t3, createLimbLathe(0.0078, 0.007, 0.006, 0.021, 12), skinMat);
    });

    this.applyPoseImmediate('Right', REST_RIGHT_ARM, 'RELAXED');
    this.applyPoseImmediate('Left', REST_LEFT_ARM, 'RELAXED');
    this.avatarRoot.add(group);
  }

  private computePoseBoneQuaternions(
    rightArm: ArmTarget,
    leftArm: ArmTarget,
    rightHand: HandshapeId,
    leftHand: HandshapeId,
    facial?: FacialExpressionSpec
  ): Map<string, THREE.Quaternion> {
    const out = new Map<string, THREE.Quaternion>();

    const qChestC = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(facial?.torsoLean ?? 0, 0, 0, 'XYZ')
    );
    const qHeadC = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(facial?.headPitch ?? 0, facial?.headYaw ?? 0, facial?.headRoll ?? 0, 'XYZ')
    );

    if (!this.isGlbRig) {
      out.set('Chest', qChestC);
      out.set('Head', qHeadC);
    } else {
      const spine1W = this.bindWorldQuat.get('Spine1') ?? new THREE.Quaternion();
      const chestBindW = this.bindWorldQuat.get('Chest');
      if (chestBindW) {
        const wChestT = qChestC.clone().multiply(chestBindW);
        out.set('Chest', spine1W.clone().invert().multiply(wChestT));
      }

      const neckBindW = this.bindWorldQuat.get('Neck') ?? chestBindW ?? new THREE.Quaternion();
      const headBindW = this.bindWorldQuat.get('Head');
      if (headBindW) {
        const wNeckT = qChestC.clone().multiply(neckBindW);
        const wHeadT = qChestC.clone().multiply(qHeadC).multiply(headBindW);
        out.set('Head', wNeckT.clone().invert().multiply(wHeadT));
      }
    }

    (['Right', 'Left'] as const).forEach((side) => {
      const arm = side === 'Right' ? rightArm : leftArm;
      const hsId = side === 'Right' ? rightHand : leftHand;
      const spec = HANDSHAPES[hsId] ?? HANDSHAPES.RELAXED;
      const curlDir = side === 'Right' ? 1 : -1;
      const spreadBase = spec.spread ?? 0;

      const qArmC = new THREE.Quaternion().setFromEuler(new THREE.Euler(...arm.shoulder, 'XYZ'));
      const qForeC = new THREE.Quaternion().setFromEuler(new THREE.Euler(...arm.elbow, 'XYZ'));
      const qHandC = new THREE.Quaternion().setFromEuler(new THREE.Euler(...arm.wrist, 'XYZ'));

      const fList = [
        { n: 'Index', c: spec.index, sp: 0.14 * spreadBase },
        { n: 'Middle', c: spec.middle, sp: 0.02 * spreadBase },
        { n: 'Ring', c: spec.ring, sp: -0.09 * spreadBase },
        { n: 'Pinky', c: spec.pinky, sp: -0.2 * spreadBase },
      ];
      const opp = spec.thumbOppose ?? 0.25;

      if (!this.isGlbRig) {
        out.set(`${side}Arm`, qArmC);
        out.set(`${side}ForeArm`, qForeC);
        out.set(`${side}Hand`, qHandC);

        for (const f of fList) {
          out.set(`${side}Hand${f.n}1`, new THREE.Quaternion().setFromEuler(new THREE.Euler(f.sp, 0, curlDir * f.c * 1.38, 'XYZ')));
          out.set(`${side}Hand${f.n}2`, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, curlDir * f.c * 1.55, 'XYZ')));
          out.set(`${side}Hand${f.n}3`, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, curlDir * f.c * 1.05, 'XYZ')));
        }

        out.set(
          `${side}HandThumb1`,
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42 - opp * 0.35, curlDir * opp * 0.45, curlDir * (0.28 + opp * 0.55), 'XYZ'))
        );
        out.set(`${side}HandThumb2`, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, curlDir * spec.thumb * 0.95, 'XYZ')));
        out.set(`${side}HandThumb3`, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, curlDir * spec.thumb * 0.85, 'XYZ')));
        return;
      }

      const qDown = side === 'Right' ? this.rightArmRestToDown : this.leftArmRestToDown;
      const shoulderParentW =
        this.bindWorldQuat.get(`${side}Shoulder`) ??
        this.bindWorldQuat.get('Chest') ??
        new THREE.Quaternion();
      const wParentArm = qChestC.clone().multiply(shoulderParentW);

      const armBindW = this.bindWorldQuat.get(`${side}Arm`);
      const foreBindW = this.bindWorldQuat.get(`${side}ForeArm`);
      const handBindW = this.bindWorldQuat.get(`${side}Hand`);
      if (!armBindW || !foreBindW || !handBindW) return;

      const cArm = qChestC.clone().multiply(qArmC);
      const cFore = cArm.clone().multiply(qForeC);
      const cHand = cFore.clone().multiply(qHandC);

      const wArmT = cArm.clone().multiply(qDown).multiply(armBindW);
      const wForeT = cFore.clone().multiply(qDown).multiply(foreBindW);
      const wHandT = cHand.clone().multiply(qDown).multiply(handBindW);

      out.set(`${side}Arm`, wParentArm.clone().invert().multiply(wArmT));
      out.set(`${side}ForeArm`, wArmT.clone().invert().multiply(wForeT));
      out.set(`${side}Hand`, wForeT.clone().invert().multiply(wHandT));

      for (const f of fList) {
        const b1W = this.bindWorldQuat.get(`${side}Hand${f.n}1`);
        const b2W = this.bindWorldQuat.get(`${side}Hand${f.n}2`);
        const b3W = this.bindWorldQuat.get(`${side}Hand${f.n}3`);
        if (!b1W || !b2W || !b3W) continue;

        const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.sp, 0, curlDir * f.c * 1.38, 'XYZ'));
        const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, curlDir * f.c * 1.55, 'XYZ'));
        const q3 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, curlDir * f.c * 1.05, 'XYZ'));

        const c1 = cHand.clone().multiply(q1);
        const c2 = c1.clone().multiply(q2);
        const c3 = c2.clone().multiply(q3);

        const w1 = c1.clone().multiply(qDown).multiply(b1W);
        const w2 = c2.clone().multiply(qDown).multiply(b2W);
        const w3 = c3.clone().multiply(qDown).multiply(b3W);

        out.set(`${side}Hand${f.n}1`, wHandT.clone().invert().multiply(w1));
        out.set(`${side}Hand${f.n}2`, w1.clone().invert().multiply(w2));
        out.set(`${side}Hand${f.n}3`, w2.clone().invert().multiply(w3));
      }

      const t1W = this.bindWorldQuat.get(`${side}HandThumb1`);
      const t2W = this.bindWorldQuat.get(`${side}HandThumb2`);
      const t3W = this.bindWorldQuat.get(`${side}HandThumb3`);
      if (t1W && t2W && t3W) {
        const qt1 = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, curlDir * opp * 0.28, curlDir * opp * 0.28, 'XYZ')
        );
        const qt2 = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, curlDir * spec.thumb * 0.35, curlDir * spec.thumb * 0.25, 'XYZ')
        );
        const qt3 = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, curlDir * spec.thumb * 0.3, curlDir * spec.thumb * 0.2, 'XYZ')
        );

        const ct1 = cHand.clone().multiply(qt1);
        const ct2 = ct1.clone().multiply(qt2);
        const ct3 = ct2.clone().multiply(qt3);

        const wt1 = ct1.clone().multiply(qDown).multiply(t1W);
        const wt2 = ct2.clone().multiply(qDown).multiply(t2W);
        const wt3 = ct3.clone().multiply(qDown).multiply(t3W);

        out.set(`${side}HandThumb1`, wHandT.clone().invert().multiply(wt1));
        out.set(`${side}HandThumb2`, wt1.clone().invert().multiply(wt2));
        out.set(`${side}HandThumb3`, wt2.clone().invert().multiply(wt3));
      }
    });

    return out;
  }

  private applyPoseImmediate(side: 'Right' | 'Left', arm: ArmTarget, handshape: HandshapeId) {
    const quats = this.computePoseBoneQuaternions(
      side === 'Right' ? arm : REST_RIGHT_ARM,
      side === 'Left' ? arm : REST_LEFT_ARM,
      side === 'Right' ? handshape : 'RELAXED',
      side === 'Left' ? handshape : 'RELAXED'
    );
    quats.forEach((q, boneName) => {
      if (boneName.startsWith(side) || boneName === 'Chest' || boneName === 'Head') {
        const bone = this.bones.get(boneName);
        if (bone) bone.quaternion.copy(q);
      }
    });
  }

  private buildQuaternionTrackForBone(
    boneName: string,
    times: number[],
    quaternions: THREE.Quaternion[]
  ): THREE.QuaternionKeyframeTrack {
    const values: number[] = [];
    for (const q of quaternions) {
      values.push(q.x, q.y, q.z, q.w);
    }
    const track = new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values);
    track.setInterpolation(THREE.InterpolateSmooth);
    return track;
  }

  private compileSignClip(sign: NslSignEntry): THREE.AnimationClip {
    const cached = this.clipCache.get(sign.signCode);
    if (cached) return cached;

    const dur = Math.max(0.38, sign.durationSec);
    const kfs: SignKeyframe[] = sign.keyframes;
    const times = kfs.map((k) => k.t * dur);

    const perBoneQuats = new Map<string, THREE.Quaternion[]>();
    for (const kf of kfs) {
      const poseMap = this.computePoseBoneQuaternions(
        kf.rightArm,
        kf.leftArm ?? REST_LEFT_ARM,
        kf.rightHand,
        kf.leftHand ?? 'RELAXED',
        kf.facial
      );
      poseMap.forEach((q, boneName) => {
        if (!this.bones.has(boneName)) return;
        let arr = perBoneQuats.get(boneName);
        if (!arr) {
          arr = [];
          perBoneQuats.set(boneName, arr);
        }
        arr.push(q);
      });
    }

    const tracks: THREE.KeyframeTrack[] = [];
    perBoneQuats.forEach((quats, boneName) => {
      if (quats.length === times.length) {
        tracks.push(this.buildQuaternionTrackForBone(boneName, times, quats));
      }
    });

    const clip = new THREE.AnimationClip(sign.signCode, dur, tracks);
    clip.optimize();
    this.clipCache.set(sign.signCode, clip);
    return clip;
  }

  private createIdleClip(): THREE.AnimationClip {
    const dur = 3.8;
    const times = [0, 1.9, 3.8];

    const idlePoses = [
      this.computePoseBoneQuaternions(
        REST_RIGHT_ARM,
        REST_LEFT_ARM,
        'RELAXED',
        'RELAXED',
        { torsoLean: 0.01, headPitch: 0, headYaw: -0.025, headRoll: 0 }
      ),
      this.computePoseBoneQuaternions(
        { shoulder: [-0.09, 0, -0.08], elbow: [-0.28, 0, 0.04], wrist: [0, 0, 0] },
        { shoulder: [-0.09, 0, 0.08], elbow: [-0.28, 0, -0.04], wrist: [0, 0, 0] },
        'RELAXED',
        'RELAXED',
        { torsoLean: -0.014, headPitch: 0.018, headYaw: 0.025, headRoll: 0.012 }
      ),
      this.computePoseBoneQuaternions(
        REST_RIGHT_ARM,
        REST_LEFT_ARM,
        'RELAXED',
        'RELAXED',
        { torsoLean: 0.01, headPitch: 0, headYaw: -0.025, headRoll: 0 }
      ),
    ];

    const perBoneQuats = new Map<string, THREE.Quaternion[]>();
    for (const poseMap of idlePoses) {
      poseMap.forEach((q, boneName) => {
        if (!this.bones.has(boneName)) return;
        let arr = perBoneQuats.get(boneName);
        if (!arr) {
          arr = [];
          perBoneQuats.set(boneName, arr);
        }
        arr.push(q);
      });
    }

    const tracks: THREE.KeyframeTrack[] = [];
    perBoneQuats.forEach((quats, boneName) => {
      if (quats.length === times.length) {
        tracks.push(this.buildQuaternionTrackForBone(boneName, times, quats));
      }
    });

    return new THREE.AnimationClip('IDLE_BREATHE', dur, tracks);
  }

  private createReadyClip(): THREE.AnimationClip {
    const dur = 2.4;
    const times = [0, 1.2, 2.4];
    const readyRight = { shoulder: [-0.46, 0.05, -0.04] as [number, number, number], elbow: [-1.42, 0, 0] as [number, number, number], wrist: [0, -1.35, 0] as [number, number, number] };
    const readyLeft = { shoulder: [-0.46, -0.05, 0.04] as [number, number, number], elbow: [-1.42, 0, 0] as [number, number, number], wrist: [0, 1.35, 0] as [number, number, number] };

    const poses = [
      this.computePoseBoneQuaternions(readyRight, readyLeft, 'RELAXED', 'RELAXED', { torsoLean: 0.02, headPitch: 0.01, smile: 0.3 }),
      this.computePoseBoneQuaternions(
        { shoulder: [-0.49, 0.05, -0.05], elbow: [-1.46, 0, 0], wrist: [0, -1.35, 0] },
        { shoulder: [-0.49, -0.05, 0.05], elbow: [-1.46, 0, 0], wrist: [0, 1.35, 0] },
        'RELAXED',
        'RELAXED',
        { torsoLean: 0.0, headPitch: -0.01, smile: 0.35 }
      ),
      this.computePoseBoneQuaternions(readyRight, readyLeft, 'RELAXED', 'RELAXED', { torsoLean: 0.02, headPitch: 0.01, smile: 0.3 }),
    ];

    const perBoneQuats = new Map<string, THREE.Quaternion[]>();
    for (const poseMap of poses) {
      poseMap.forEach((q, boneName) => {
        if (!this.bones.has(boneName)) return;
        let arr = perBoneQuats.get(boneName);
        if (!arr) {
          arr = [];
          perBoneQuats.set(boneName, arr);
        }
        arr.push(q);
      });
    }

    const tracks: THREE.KeyframeTrack[] = [];
    perBoneQuats.forEach((quats, boneName) => {
      if (quats.length === times.length) {
        tracks.push(this.buildQuaternionTrackForBone(boneName, times, quats));
      }
    });

    return new THREE.AnimationClip('READY_TO_SIGN', dur, tracks);
  }

  public setReadyToSign(active: boolean) {
    if (this.isListeningReady === active) return;
    this.isListeningReady = active;
    if (this.isPlaying) return;

    if (active) {
      this.readyAction.reset().setEffectiveWeight(1).play();
      this.idleAction.crossFadeTo(this.readyAction, 0.22, true);
    } else {
      this.idleAction.reset().setEffectiveWeight(1).play();
      this.readyAction.crossFadeTo(this.idleAction, 0.3, true);
    }
  }

  public enqueueSequence(items: TranslationSignItem[], replaceActive = false) {
    const playable: QueuedSignPlayback[] = [];

    for (const item of items) {
      if (item.type === 'fingerspell' && item.letters && item.letters.length > 0) {
        for (const ch of item.letters) {
          const upper = ch.toUpperCase();
          const fsSign = NSL_BY_CODE.get(`NSL_FS_${upper}`);
          if (fsSign) {
            playable.push({
              item: {
                ...item,
                gloss: `FS-${upper}`,
                displayLabel: `${item.sourceWord} (${upper})`,
              },
              sign: fsSign,
            });
          }
        }
      } else if (item.type === 'verified_sign') {
        const sign =
          (item.signCode ? NSL_BY_CODE.get(item.signCode.toUpperCase()) : undefined) ??
          NSL_BY_GLOSS.get(item.gloss.toUpperCase());
        if (sign) {
          playable.push({ item, sign });
        }
      }
    }

    if (playable.length === 0) return;

    if (replaceActive || !this.isPlaying) {
      this.queue = [...playable];
      this.lastSequence = [...playable];
      this.activeIndex = -1;
      this.isPlaying = true;
      this.isPaused = false;
      this.advanceQueue();
    } else {
      this.queue.push(...playable);
      this.lastSequence = [...this.queue];
      this.emitPlaybackState();
    }
  }

  public playSingleSign(sign: NslSignEntry) {
    const item: TranslationSignItem = {
      id: `preview-${sign.signCode}`,
      type: 'verified_sign',
      gloss: sign.gloss,
      displayLabel: sign.englishMeaning,
      signCode: sign.signCode,
      sourceWord: sign.englishMeaning,
      facialExpression: sign.facialExpression,
      nonManualMarkers: sign.nonManualMarkers,
      notes: sign.translationNotes,
    };
    this.enqueueSequence([item], true);
  }

  public replayLast() {
    if (this.lastSequence.length === 0) return;
    this.queue = [...this.lastSequence];
    this.activeIndex = -1;
    this.isPlaying = true;
    this.isPaused = false;
    this.advanceQueue();
  }

  public pause() {
    this.isPaused = true;
    if (this.activeAction) this.activeAction.paused = true;
    this.emitPlaybackState();
  }

  public resume() {
    this.isPaused = false;
    if (this.activeAction) this.activeAction.paused = false;
    this.emitPlaybackState();
  }

  public stopAndReset() {
    this.queue = [];
    this.activeIndex = -1;
    this.isPlaying = false;
    this.isPaused = false;
    if (this.activeAction) {
      this.activeAction.fadeOut(0.2);
      this.activeAction = null;
    }
    this.idleAction.reset().fadeIn(0.25).play();
    this.facialTarget = { browRaise: 0, browFurrow: 0, smile: 0.18, mouthOpen: 0 };
    this.callbacks.onActiveSignChange?.(-1, null, null);
    this.emitPlaybackState();
  }

  public setSpeed(speed: number) {
    this.speed = THREE.MathUtils.clamp(speed, 0.4, 1.8);
    if (this.activeAction) {
      this.activeAction.timeScale = this.speed;
    }
  }

  public setAvatarScale(scale: number) {
    this.avatarScale = THREE.MathUtils.clamp(scale, 0.8, 1.25);
    this.avatarRoot.scale.setScalar(this.avatarScale);
  }

  public setCameraPreset(preset: CameraPreset) {
    const p = CAMERA_PRESETS[preset];
    this.desiredCamPos.set(...p.pos);
    this.desiredCamTarget.set(...p.target);
    this.camTransitionActive = true;
  }

  private advanceQueue() {
    this.activeIndex += 1;
    if (this.activeIndex >= this.queue.length) {
      this.isPlaying = false;
      this.activeIndex = -1;
      const baseAction = this.isListeningReady ? this.readyAction : this.idleAction;
      if (this.activeAction) {
        baseAction.reset().setEffectiveWeight(1).play();
        this.activeAction.crossFadeTo(baseAction, 0.16, true);
        this.activeAction = null;
      }
      this.facialTarget = { browRaise: 0, browFurrow: 0, smile: 0.18, mouthOpen: 0 };
      this.callbacks.onActiveSignChange?.(-1, null, null);
      this.emitPlaybackState();
      return;
    }

    const entry = this.queue[this.activeIndex];
    const clip = this.compileSignClip(entry.sign);
    const nextAction = this.mixer.clipAction(clip);
    nextAction.reset();
    nextAction.setLoop(THREE.LoopOnce, 1);
    nextAction.clampWhenFinished = true;
    nextAction.timeScale = this.speed;
    nextAction.enabled = true;

    const fadeDuration = 0.08;
    if (this.activeAction) {
      this.activeAction.crossFadeTo(nextAction, fadeDuration, true);
    } else {
      const fromAction = this.isListeningReady ? this.readyAction : this.idleAction;
      fromAction.crossFadeTo(nextAction, fadeDuration, true);
    }
    nextAction.play();
    this.activeAction = nextAction;

    const peakFacial = this.extractPeakFacial(entry.sign.keyframes);
    this.facialTarget = {
      browRaise: peakFacial.browRaise ?? 0,
      browFurrow: peakFacial.browFurrow ?? 0,
      smile: peakFacial.smile ?? 0.18,
      mouthOpen: peakFacial.mouthOpen ?? 0.04,
    };

    this.callbacks.onActiveSignChange?.(this.activeIndex, entry.item, entry.sign);
    this.emitPlaybackState();
  }

  private extractPeakFacial(kfs: SignKeyframe[]): FacialExpressionSpec {
    let best: FacialExpressionSpec = {};
    for (const k of kfs) {
      if (k.facial) {
        best = {
          browRaise: Math.max(best.browRaise ?? 0, k.facial.browRaise ?? 0),
          browFurrow: Math.max(best.browFurrow ?? 0, k.facial.browFurrow ?? 0),
          smile: Math.max(best.smile ?? 0, k.facial.smile ?? 0),
          mouthOpen: Math.max(best.mouthOpen ?? 0, k.facial.mouthOpen ?? 0),
        };
      }
    }
    return best;
  }

  private emitPlaybackState() {
    this.callbacks.onPlaybackStateChange?.({
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      queueLength: this.queue.length,
      activeIndex: this.activeIndex,
    });
  }

  private updateFacialAndBlink(dt: number) {
    const k = 9.0;
    this.facialCurrent.browRaise = THREE.MathUtils.damp(this.facialCurrent.browRaise, this.facialTarget.browRaise, k, dt);
    this.facialCurrent.browFurrow = THREE.MathUtils.damp(this.facialCurrent.browFurrow, this.facialTarget.browFurrow, k, dt);
    this.facialCurrent.smile = THREE.MathUtils.damp(this.facialCurrent.smile, this.facialTarget.smile, k, dt);
    this.facialCurrent.mouthOpen = THREE.MathUtils.damp(this.facialCurrent.mouthOpen, this.facialTarget.mouthOpen, k, dt);

    this.blinkTimer += dt;
    let blinkAmount = 0;
    if (this.blinkTimer >= this.nextBlinkAt) {
      const elapsed = this.blinkTimer - this.nextBlinkAt;
      if (elapsed < 0.16) {
        blinkAmount = Math.sin((elapsed / 0.16) * Math.PI);
      } else {
        this.blinkTimer = 0;
        this.nextBlinkAt = 2.8 + Math.random() * 2.5;
      }
    }

    if (this.morphMeshes.length > 0) {
      const setMorph = (dict: Record<string, number>, inf: number[], key: string, val: number) => {
        const idx = dict[key];
        if (idx !== undefined) inf[idx] = val;
      };
      for (const mesh of this.morphMeshes) {
        const dict = mesh.morphTargetDictionary;
        const inf = mesh.morphTargetInfluences;
        if (!dict || !inf) continue;

        setMorph(dict, inf, 'h_expressions.LbrowUp_h', this.facialCurrent.browRaise * 0.8);
        setMorph(dict, inf, 'h_expressions.RbrowUp_h', this.facialCurrent.browRaise * 0.8);
        setMorph(dict, inf, 'h_expressions.LbrowDown_h', this.facialCurrent.browFurrow * 0.85);
        setMorph(dict, inf, 'h_expressions.RbrowDown_h', this.facialCurrent.browFurrow * 0.85);
        setMorph(dict, inf, 'h_expressions.MouthOpen_h', this.facialCurrent.mouthOpen * 0.75);
        setMorph(dict, inf, 'h_expressions.LsmileClose_h', this.facialCurrent.smile * 0.7);
        setMorph(dict, inf, 'h_expressions.RsmileClose_h', this.facialCurrent.smile * 0.7);
        setMorph(dict, inf, 'h_expressions.LeyeOpen_h', Math.max(0.18, this.facialCurrent.browRaise * 0.45) * (1 - blinkAmount));
        setMorph(dict, inf, 'h_expressions.ReyeOpen_h', Math.max(0.18, this.facialCurrent.browRaise * 0.45) * (1 - blinkAmount));
        setMorph(dict, inf, 'h_expressions.LeyeClose_h', blinkAmount);
        setMorph(dict, inf, 'h_expressions.ReyeClose_h', blinkAmount);
      }
    }

    if (this.browNodes.left && this.browNodes.right) {
      const browDelta = this.facialCurrent.browRaise * 0.008 - this.facialCurrent.browFurrow * 0.006;
      const browTilt = this.facialCurrent.browFurrow * 0.22 - this.facialCurrent.browRaise * 0.06;
      if (!this.isGlbRig) {
        this.browNodes.left.position.y = this.browNodes.baseY + browDelta;
        this.browNodes.right.position.y = this.browNodes.baseY + browDelta;
        this.browNodes.left.rotation.z = browTilt;
        this.browNodes.right.rotation.z = -browTilt;
      }
    }

    if (!this.isGlbRig) {
      if (this.jawGroup) this.jawGroup.rotation.x = this.facialCurrent.mouthOpen * 0.32;
      if (this.mouthSmileBar) {
        this.mouthSmileBar.scale.x = 1 + this.facialCurrent.smile * 0.25;
        this.mouthSmileBar.position.y = -0.012 + this.facialCurrent.smile * 0.003;
      }
      const lidRot = -0.9 + blinkAmount * 0.92;
      if (this.leftEyelid) this.leftEyelid.rotation.x = lidRot;
      if (this.rightEyelid) this.rightEyelid.rotation.x = lidRot;
    } else {
      const neckBone = this.bones.get('Neck');
      const neckBindL = this.bindLocalQuat.get('Neck');
      if (neckBone && neckBindL) {
        const pitch = this.facialCurrent.browFurrow * 0.06 - this.facialCurrent.browRaise * 0.05;
        const roll = this.facialCurrent.smile > 0.5 ? 0.03 : 0;
        _euler.set(pitch, 0, roll, 'XYZ');
        _qTemp.setFromEuler(_euler);
        neckBone.quaternion.copy(neckBindL).multiply(_qTemp);
      }
    }
  }

  private tick = () => {
    if (this.disposed) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.mixer.update(dt);
    this.updateFacialAndBlink(dt);

    if (this.camTransitionActive) {
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.desiredCamPos.x, 7, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.desiredCamPos.y, 7, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.desiredCamPos.z, 7, dt);
      this.controls.target.x = THREE.MathUtils.damp(this.controls.target.x, this.desiredCamTarget.x, 7, dt);
      this.controls.target.y = THREE.MathUtils.damp(this.controls.target.y, this.desiredCamTarget.y, 7, dt);
      this.controls.target.z = THREE.MathUtils.damp(this.controls.target.z, this.desiredCamTarget.z, 7, dt);

      if (
        this.camera.position.distanceToSquared(this.desiredCamPos) < 0.0002 &&
        this.controls.target.distanceToSquared(this.desiredCamTarget) < 0.0002
      ) {
        this.camTransitionActive = false;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(() => {
        if (!this.disposed) this.tick();
      });
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  public handleResize() {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 320);
    const height = Math.max(this.container.clientHeight, 320);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.mixer.stopAllAction();

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
