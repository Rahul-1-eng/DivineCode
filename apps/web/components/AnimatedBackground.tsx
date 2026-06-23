import { useEffect, useRef } from 'react';
// @ts-ignore: Bypassing missing types for immediate deployment
import * as THREE from 'three';

export default function AnimatedBackground() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    
    // Check if user prefers reduced motion (accessibility)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 60;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    // Cap pixel ratio for performance
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height);
    mountRef.current.appendChild(renderer.domElement);

    // --- Particle field ---
    const PARTICLE_COUNT = width < 700 ? 120 : 220;
    const FIELD = 140; 

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities: { x: number, y: number, z: number }[] = [];
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * FIELD;
      positions[i * 3 + 1] = (Math.random() - 0.5) * FIELD * 0.6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * FIELD * 0.6 - 20;
      velocities.push({
        x: (Math.random() - 0.5) * 0.02,
        y: (Math.random() - 0.5) * 0.02,
        z: (Math.random() - 0.5) * 0.02
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Procedural glow texture
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    grad.addColorStop(0, 'rgba(148, 163, 184, 0.4)'); // Dimmer center
    grad.addColorStop(0.35, 'rgba(30, 58, 138, 0.2)'); // Darker blue edge
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    
    const particleMaterial = new THREE.PointsMaterial({
      size: 1.6,
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: new THREE.Color('#7dd3fc')
    });
    
    const points = new THREE.Points(geometry, particleMaterial);
    scene.add(points);

    // --- Connecting Lines ---
    const lineGeometry = new THREE.BufferGeometry();
    const MAX_LINE_VERTS = PARTICLE_COUNT * 12; 
    const linePositions = new Float32Array(MAX_LINE_VERTS * 3);
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    
    const lineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color('#334155'),
      transparent: true,
      opacity: 0.35
    });
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lines);

    const LINK_DIST = 16;

    const updateLinks = () => {
      let vertexIndex = 0;
      const pos = geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        for (let j = i + 1; j < PARTICLE_COUNT; j++) {
          const dx = pos[i*3] - pos[j*3];
          const dy = pos[i*3+1] - pos[j*3+1];
          const dz = pos[i*3+2] - pos[j*3+2];
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          
          if (dist < LINK_DIST && vertexIndex < MAX_LINE_VERTS - 2) {
            linePositions[vertexIndex*3]     = pos[i*3];
            linePositions[vertexIndex*3 + 1] = pos[i*3+1];
            linePositions[vertexIndex*3 + 2] = pos[i*3+2];
            vertexIndex++;
            linePositions[vertexIndex*3]     = pos[j*3];
            linePositions[vertexIndex*3 + 1] = pos[j*3+1];
            linePositions[vertexIndex*3 + 2] = pos[j*3+2];
            vertexIndex++;
          }
        }
      }
      lineGeometry.setDrawRange(0, vertexIndex);
      lineGeometry.attributes.position.needsUpdate = true;
    };

    // --- Interaction & Animation ---
    let mouseX = 0, mouseY = 0;
    let targetRotX = 0, targetRotY = 0;
    let animationFrameId: number;
    let running = true;

    const onMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseY = (e.clientY / window.innerHeight) * 2 - 1;
    };

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const onVisibilityChange = () => {
      running = !document.hidden;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibilityChange);

    let frame = 0;
    const animate = () => {
      if (!running) {
        animationFrameId = requestAnimationFrame(animate);
        return;
      }
      
      frame++;

      if (!reduceMotion) {
        const pos = geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          pos[i*3]     += velocities[i].x;
          pos[i*3 + 1] += velocities[i].y;
          pos[i*3 + 2] += velocities[i].z;

          if (Math.abs(pos[i*3])     > FIELD/2)        velocities[i].x *= -1;
          if (Math.abs(pos[i*3+1])   > FIELD*0.6/2)    velocities[i].y *= -1;
          if (Math.abs(pos[i*3+2]+20)> FIELD*0.6/2)    velocities[i].z *= -1;
        }
        geometry.attributes.position.needsUpdate = true;

        if (frame % 4 === 0) updateLinks();

        targetRotY += (mouseX * 0.25 - targetRotY) * 0.03;
        targetRotX += (-mouseY * 0.15 - targetRotX) * 0.03;
        scene.rotation.y = targetRotY;
        scene.rotation.x = targetRotX;
        points.rotation.z += 0.0006;
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    if (reduceMotion) {
      updateLinks();
      renderer.render(scene, camera);
    } else {
      animate();
    }

    // --- Cleanup ---
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancelAnimationFrame(animationFrameId);
      
      if (mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      
      geometry.dispose();
      particleMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }} />;
}