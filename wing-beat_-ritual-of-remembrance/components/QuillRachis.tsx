
import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Fix for JSX intrinsic element errors and SVG tag name conflicts ('line')
const Group = 'group' as any;
const Line = 'line' as any;
const LineBasicMaterial = 'lineBasicMaterial' as any;
const Mesh = 'mesh' as any;
const SphereGeometry = 'sphereGeometry' as any;
const MeshBasicMaterial = 'meshBasicMaterial' as any;

interface QuillRachisProps {
  volume: number;
  sensitivity: number;
}

export const QuillRachis: React.FC<QuillRachisProps> = ({ volume, sensitivity }) => {
  const lineRef = useRef<THREE.Line>(null);
  const pointsRef = useRef<THREE.Vector3[]>([]);

  // Create initial points for the rachis curve
  const initialPoints = useMemo(() => {
    const pts = [];
    const segments = 64;
    const length = 4;
    for (let i = 0; i <= segments; i++) {
      const y = (i / segments) * length - length / 2;
      // Natural slight curve
      const x = Math.sin(y * 0.5) * 0.1;
      pts.push(new THREE.Vector3(x, y, 0));
    }
    pointsRef.current = pts;
    return pts;
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints(initialPoints);
    return geo;
  }, [initialPoints]);

  useFrame((state) => {
    if (!lineRef.current) return;

    const time = state.clock.getElapsedTime();
    const positions = lineRef.current.geometry.attributes.position.array as Float32Array;

    // Movement logic: Apply threshold to stop motion entirely if silent
    const threshold = 0.005;
    const activeVolume = volume < threshold ? 0 : volume;
    const drive = activeVolume * sensitivity;
    
    for (let i = 0; i < pointsRef.current.length; i++) {
        const idx = i * 3;
        const p = initialPoints[i];
        
        // Reactive movement: The tip moves more than the base (quill)
        const taperFactor = (i / pointsRef.current.length); // 0 at base, 1 at tip
        
        // Base sine wave movement is now scaled by drive
        const waveX = Math.sin(time * 2 + p.y * 2) * 0.05 * drive;
        const waveZ = Math.cos(time * 1.5 + p.y * 3) * 0.03 * drive;

        // Turbulence noise also scaled by drive and sensitivity
        const noiseX = (Math.random() - 0.5) * drive * 0.1 * taperFactor;
        const noiseZ = (Math.random() - 0.5) * drive * 0.1 * taperFactor;

        // Update attribute positions
        positions[idx] = p.x + waveX + noiseX;
        positions[idx + 1] = p.y;
        positions[idx + 2] = p.z + waveZ + noiseZ;
    }

    lineRef.current.geometry.attributes.position.needsUpdate = true;
    
    // Pulse line opacity based on volume
    if (lineRef.current.material instanceof THREE.LineBasicMaterial) {
      lineRef.current.material.opacity = 0.2 + activeVolume * 0.8;
      // Color shifts from grey to white-blue when active
      const lightness = 0.5 + activeVolume * 0.5;
      lineRef.current.material.color.setHSL(0.6, 0.1, lightness);
    }
  });

  return (
    <Group rotation={[0, 0, Math.PI * 0.05]}>
      {/* The main Rachis line */}
      <Line ref={lineRef} geometry={geometry}>
        <LineBasicMaterial 
          color="#ffffff" 
          transparent 
          opacity={0.4} 
          linewidth={1}
          blending={THREE.AdditiveBlending}
        />
      </Line>

      {/* Quill base indicator */}
      <Mesh position={[0, -2, 0]} scale={[0.05, 0.1, 0.05]}>
        <SphereGeometry args={[1, 16, 16]} />
        <MeshBasicMaterial color="#ffffff" transparent opacity={0.1 + volume * 0.3} />
      </Mesh>
    </Group>
  );
};
