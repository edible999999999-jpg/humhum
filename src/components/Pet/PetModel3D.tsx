import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AGENT_BRAND_COLOR } from "@/engine/constants";
import type { PetState } from "@/types";

const HUMI_MODEL_SRC = "/mascots/3d/humi-window-pet-geometry.glb";
const HUMI_TEXTURE_SRC = "/mascots/3d/humi-window-pet-basecolor.jpg";

interface PetModel3DProps {
  state: PetState;
  size: number;
  activeClients: string[];
  onReady: () => void;
  onUnavailable: () => void;
}

export function PetModel3D({
  state,
  size,
  activeClients,
  onReady,
  onUnavailable,
}: PetModel3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const clientsRef = useRef(activeClients);
  const readyRef = useRef(false);

  stateRef.current = state;
  clientsRef.current = activeClients;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;
    let model: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const startTime = performance.now();
    let lastTime = startTime;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      console.error("[PetModel3D] webgl-init-failed", error);
      onUnavailable();
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = `${size}px`;
    renderer.domElement.style.height = `${size}px`;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.pointerEvents = "none";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 0.25, 5.4);

    const ambient = new THREE.HemisphereLight(0xffffff, 0xdff6ff, 1.65);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(2.4, 3.2, 4);
    scene.add(key);

    const faceFill = new THREE.DirectionalLight(0xfffbf7, 1.15);
    faceFill.position.set(-0.4, 1.1, 4.8);
    scene.add(faceFill);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 48),
      new THREE.MeshBasicMaterial({
        color: 0x7d8a93,
        transparent: true,
        opacity: 0.045,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.55;
    shadow.scale.set(1.35, 0.38, 1);
    scene.add(shadow);

    const agentGroup = new THREE.Group();
    scene.add(agentGroup);

    const loader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();

    Promise.all([
      new Promise<import("three/examples/jsm/loaders/GLTFLoader.js").GLTF>((resolve, reject) => {
        loader.load(HUMI_MODEL_SRC, resolve, undefined, reject);
      }),
      new Promise<THREE.Texture>((resolve, reject) => {
        textureLoader.load(HUMI_TEXTURE_SRC, resolve, undefined, reject);
      }),
    ]).then(
      ([gltf, baseColorTexture]) => {
        if (disposed) return;

        baseColorTexture.colorSpace = THREE.SRGBColorSpace;
        baseColorTexture.flipY = false;
        baseColorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        baseColorTexture.needsUpdate = true;

        model = gltf.scene;
        prepareModel(model, baseColorTexture);
        fitModel(model);
        scene.add(model);

        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          gltf.animations.forEach((clip) => mixer?.clipAction(clip).play());
        }

        readyRef.current = true;
        onReady();
      },
      (error) => {
        console.error("[PetModel3D] gltf-load-failed", HUMI_MODEL_SRC, error);
        if (!disposed) onUnavailable();
      },
    );

    function prepareModel(root: THREE.Object3D, baseColorTexture: THREE.Texture) {
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => {
          const standardMaterial = material as THREE.MeshStandardMaterial;
          standardMaterial.map = baseColorTexture;
          standardMaterial.color?.set(0xffffff);
          standardMaterial.metalness = 0;
          standardMaterial.roughness = 0.68;
          standardMaterial.emissive?.set(0xf7fbff);
          standardMaterial.emissiveIntensity = 0.18;
          material.transparent = material.transparent || material.opacity < 1;
          material.needsUpdate = true;
        });
      });
    }

    function fitModel(root: THREE.Object3D) {
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const dimensions = box.getSize(new THREE.Vector3());
      const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z) || 1;
      const scale = 2.45 / maxDimension;

      root.position.sub(center);
      root.scale.setScalar(scale);
      root.position.y -= 0.08;
      root.rotation.y = -0.18;
    }

    function syncAgentOrbs(time: number) {
      const clients = clientsRef.current.slice(0, 5);
      while (agentGroup.children.length < clients.length) {
        const orb = new THREE.Mesh(
          new THREE.SphereGeometry(0.045, 18, 18),
          new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0x55e7f2,
            emissiveIntensity: 0.55,
            roughness: 0.28,
            metalness: 0.05,
          }),
        );
        agentGroup.add(orb);
      }
      while (agentGroup.children.length > clients.length) {
        const orb = agentGroup.children.pop();
        disposeObject(orb);
      }

      clients.forEach((client, index) => {
        const orb = agentGroup.children[index] as THREE.Mesh;
        const material = orb.material as THREE.MeshStandardMaterial;
        const color = new THREE.Color(AGENT_BRAND_COLOR[client] ?? "#94a3b8");
        material.color.copy(color);
        material.emissive.copy(color);

        const phase = time * 0.85 + index * ((Math.PI * 2) / Math.max(clients.length, 1));
        const radius = 1.15 + index * 0.025;
        orb.position.set(
          Math.cos(phase) * radius,
          -0.08 + Math.sin(time * 1.4 + index) * 0.08,
          Math.sin(phase) * radius * 0.35,
        );
        orb.scale.setScalar(1 + Math.sin(time * 2.2 + index) * 0.12);
      });
    }

    function animate() {
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      const time = (now - startTime) / 1000;
      lastTime = now;

      if (mixer) mixer.update(dt);

      if (model) {
        const current = stateRef.current;
        const bob =
          current === "processing"
            ? Math.sin(time * 3.2) * 0.055
            : current === "speaking"
              ? Math.sin(time * 5.4) * 0.045
              : Math.sin(time * 1.8) * 0.035;
        const turn =
          current === "error"
            ? Math.sin(time * 7) * 0.035
            : Math.sin(time * 0.72) * 0.1;

        model.position.y = bob - 0.08;
        model.rotation.y = -0.18 + turn;
        model.rotation.z =
          current === "waiting" ? Math.sin(time * 2.1) * 0.025 : Math.sin(time * 0.9) * 0.018;
      }

      syncAgentOrbs(time);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    }

    frame = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      readyRef.current = false;
      mixer?.stopAllAction();
      scene.traverse(disposeObject);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [onReady, onUnavailable, size]);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 select-none pointer-events-none"
      data-pet-3d={readyRef.current ? "ready" : "loading"}
      style={{ width: size, height: size }}
    />
  );
}

function disposeObject(object?: THREE.Object3D | null) {
  if (!object) return;

  const mesh = object as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();

  const material = mesh.material;
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
  } else if (material) {
    material.dispose();
  }
}
