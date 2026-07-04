/**
 * @file AnimatedBackground.tsx
 * @author Rahul Kumar Sahoo
 * @description Reusable UI component for the product experience.
 */

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
    // Deep dark void core to ensure perfect typography contrast
    scene.background = new THREE.Color('#020617'); 
    scene.fog = new THREE.FogExp2('#020617', 0.007);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 80;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    // Cap pixel ratio for performance while keeping it sharp
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    mountRef.current.appendChild(renderer.domElement);

    // --- Cosmic Neural Mesh Dataset (The Vortex) ---
    const particleCount = width < 768 ? 1500 : 3500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const baseColor = new THREE.Color('#22d3ee');   // Cyan/Blue
    const accentColor = new THREE.Color('#818cf8'); // Indigo/Purple

    for (let i = 0; i < particleCount; i++) {
      // Create structural data streams along a cylindrical/wormhole coordinate system
      const angle = Math.random() * Math.PI * 2;
      const radius = 15 + Math.random() * 75;
      const depth = (Math.random() - 0.5) * 250;

      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius;
      positions[i * 3 + 2] = depth;

      // Mix colors for a glowing ethereal gradient look
      const mixedColor = baseColor.clone().lerp(accentColor, Math.random());
      colors[i * 3] = mixedColor.r;
      colors[i * 3 + 1] = mixedColor.g;
      colors[i * 3 + 2] = mixedColor.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Procedural glow shader map texture (Makes dots look like glowing orbs)
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(34, 211, 238, 0.6)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const material = new THREE.PointsMaterial({
      size: 1.4,
      map: new THREE.CanvasTexture(canvas),
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const particleMesh = new THREE.Points(geometry, material);
    scene.add(particleMesh);

    // --- Interaction & Animation ---
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;
    let animationFrameId: number;
    let running = true;

    const onMouseMove = (event: MouseEvent) => {
      mouseX = (event.clientX - width / 2) * 0.05;
      mouseY = (event.clientY - height / 2) * 0.05;
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

    const animate = () => {
      if (!running) {
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      if (!reduceMotion) {
        // Ethereal auto-rotation coupled with physics-based mouse damping
        targetX += (mouseX - targetX) * 0.05;
        targetY += (mouseY - targetY) * 0.05;

        particleMesh.rotation.z += 0.0015;
        particleMesh.rotation.x = targetY * 0.005;
        particleMesh.rotation.y = targetX * 0.005;

        const posArray = geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < particleCount; i++) {
          // Drive data streams forward through space
          posArray[i * 3 + 2] += 0.65;
          
          // Reset particles that go past the camera back into the deep fog
          if (posArray[i * 3 + 2] > 120) {
            posArray[i * 3 + 2] = -130;
          }
        }
        geometry.attributes.position.needsUpdate = true;
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    if (reduceMotion) {
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
      
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }} />;
}