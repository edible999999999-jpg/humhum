import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const ROLES = [
  {
    name: "Humi",
    label: "Humi notices your direction.",
    detail: "A calm reading of the work, patterns, and small next step in front of you.",
    model: "/mascots/3d/hype-jellyfish.glb",
    poster: "/mascots/posters/humi-background.png",
    color: "#dff8ef",
    accent: "#77caae",
    frontYaw: -Math.PI / 2,
  },
  {
    name: "Hype",
    label: "Hype remembers what matters.",
    detail: "Skills, preferences, and rules become context your Agents can carry with them.",
    model: "/mascots/3d/hexa-octopus.glb",
    poster: "/mascots/posters/hype-background.png",
    color: "#eee8ff",
    accent: "#9c8add",
    frontYaw: -Math.PI / 2,
  },
  {
    name: "Hush",
    label: "Hush holds your attention gently.",
    detail: "A quiet view of people and messages that may deserve your care, with your approval.",
    model: "/mascots/3d/hush-jellyfish.glb",
    poster: "/mascots/posters/hush-background.png",
    color: "#ffe4d6",
    accent: "#df9b78",
    frontYaw: -Math.PI / 2,
  },
  {
    name: "Hexa",
    label: "Hexa keeps Agents in view.",
    detail: "See where work is moving, what needs a decision, and what is ready to remember.",
    model: "/mascots/3d/hexa-yellow.glb",
    poster: "/mascots/posters/hexa-background.png",
    color: "#eaf7ff",
    accent: "#79b9dc",
    frontYaw: -Math.PI / 2,
  },
] as const;

type RoleModel = (typeof ROLES)[number];

export function RoleModelCarousel() {
  const mountRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [ready, setReady] = useState(false);
  const activeRole = ROLES[activeIndex] ?? ROLES[0];

  activeRef.current = activeIndex;

  function navigate(direction: "next" | "previous") {
    if (isAnimating) return;
    setIsAnimating(true);
    setActiveIndex((current) => (direction === "next" ? (current + 1) % ROLES.length : (current + ROLES.length - 1) % ROLES.length));
    window.setTimeout(() => setIsAnimating(false), 650);
  }

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const mountElement = mount;

    let disposed = false;
    let frame = 0;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0.1, 8.3);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "role-model-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mountElement.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb5c7dc, 2.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(3.5, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xfff6ec, 1.4);
    fill.position.set(-4, 1.5, 2);
    scene.add(fill);

    const loader = new GLTFLoader();
    const holders = new Map<string, THREE.Group>();
    const clock = new THREE.Clock();

    function resize() {
      const { width, height } = mountElement.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(mountElement);
    resize();

    function loadRole(role: RoleModel) {
      return new Promise<void>((resolve) => {
        loader.load(
          role.model,
          (gltf) => {
            if (disposed) return resolve();
            const holder = new THREE.Group();
            const model = gltf.scene;
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const largest = Math.max(size.x, size.y, size.z) || 1;
            model.position.sub(center);
            model.scale.setScalar(2.25 / largest);
            model.traverse((child) => {
              const mesh = child as THREE.Mesh;
              if (!mesh.isMesh) return;
              mesh.frustumCulled = false;
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              materials.forEach((material) => {
                const standard = material as THREE.MeshStandardMaterial;
                standard.roughness = Math.min(standard.roughness ?? 0.7, 0.72);
                standard.metalness = 0;
                standard.needsUpdate = true;
              });
            });
            holder.add(model);
            scene.add(holder);
            holders.set(role.name, holder);
            resolve();
          },
          undefined,
          () => resolve(),
        );
      });
    }

    Promise.all(ROLES.map(loadRole)).then(() => {
      if (!disposed) setReady(true);
    });

    function animate() {
      const time = clock.getElapsedTime();
      const active = activeRef.current;
      const isMobile = mountElement.clientWidth < 640;

      ROLES.forEach((role, index) => {
        const holder = holders.get(role.name);
        if (!holder) return;
        const relative = (index - active + ROLES.length) % ROLES.length;
        const rolePosition = relative === 0 ? "center" : relative === 1 ? "right" : relative === 2 ? "back" : "left";
        const target = rolePosition === "center"
          ? { x: isMobile ? -0.92 : -2.45, y: isMobile ? 0.22 : 0.92, z: 0.48, scale: isMobile ? 0.42 : 0.58, opacity: 1 }
          : { x: 0, y: 0, z: -3, scale: 0.1, opacity: 0 };
        const ease = 0.12;
        holder.position.x += (target.x - holder.position.x) * ease;
        holder.position.y += (target.y + Math.sin(time * 1.1 + index) * 0.045 - holder.position.y) * ease;
        holder.position.z += (target.z - holder.position.z) * ease;
        const currentScale = holder.scale.x || 0.001;
        const nextScale = currentScale + (target.scale - currentScale) * ease;
        holder.scale.setScalar(nextScale);
        const targetYaw = role.frontYaw + (rolePosition === "center" ? Math.sin(time * 0.45) * 0.18 : 0);
        holder.rotation.y += (targetYaw - holder.rotation.y) * ease;
        holder.rotation.z = Math.sin(time * 0.8 + index) * 0.035;
        holder.visible = target.opacity > 0.2;
      });

      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    }

    frame = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse(disposeObject);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <section className="role-model-stage" id="roles" style={{ "--role-stage-color": activeRole.color, "--role-stage-accent": activeRole.accent } as CSSProperties}>
      <div className="role-model-grain" aria-hidden="true" />
      <p className="role-model-ghost" aria-hidden="true">MEET THEM</p>
      <div className="role-model-poster" aria-hidden="true"><img src={activeRole.poster} alt="" /></div>
      <div className="role-model-canvas-wrap" ref={mountRef} data-ready={ready} />
      <div className="role-model-top"><span>02 / HUMHUM COMPANIONS</span><span>{String(activeIndex + 1).padStart(2, "0")} / 04</span></div>
      <div className="role-model-copy">
        <p>{activeRole.name}</p>
        <h2>{activeRole.label}</h2>
        <span>{activeRole.detail}</span>
        <div>
          <button type="button" onClick={() => navigate("previous")} aria-label="Previous companion"><ArrowLeft size={22} aria-hidden="true" /></button>
          <button type="button" onClick={() => navigate("next")} aria-label="Next companion"><ArrowRight size={22} aria-hidden="true" /></button>
        </div>
      </div>
      <a className="role-model-link" href="#join">See how it helps <ArrowUpRight size={23} aria-hidden="true" /></a>
    </section>
  );
}

function disposeObject(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else material?.dispose();
}
