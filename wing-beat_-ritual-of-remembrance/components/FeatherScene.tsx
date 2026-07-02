
import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stars, Float } from '@react-three/drei';
import { QuillRachis } from './QuillRachis';

// Fix for JSX intrinsic element errors when React Three Fiber types are not properly detected
const Color = 'color' as any;
const AmbientLight = 'ambientLight' as any;
const PointLight = 'pointLight' as any;
const SpotLight = 'spotLight' as any;

interface FeatherSceneProps {
  volume: number;
  sensitivity: number;
}

export const FeatherScene: React.FC<FeatherSceneProps> = ({ volume, sensitivity }) => {
  return (
    <Canvas
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
      className="w-full h-full"
    >
      <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={50} />
      <Color attach="background" args={['#050505']} />
      
      <AmbientLight intensity={0.2} />
      <PointLight position={[10, 10, 10]} intensity={1} color="#ffffff" />
      <SpotLight position={[-10, 10, 10]} angle={0.15} penumbra={1} intensity={2} color="#4477ff" />

      <Suspense fallback={null}>
        <Float 
          speed={1.5 * (volume > 0.01 ? 1 : 0)} 
          rotationIntensity={0.2 * (volume > 0.01 ? 1 : 0)} 
          floatIntensity={0.5 * (volume > 0.01 ? 1 : 0)}
        >
          <QuillRachis volume={volume} sensitivity={sensitivity} />
        </Float>
        
        {/* Ambient atmospheric particles */}
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      </Suspense>

      <OrbitControls 
        enablePan={false} 
        enableZoom={false} 
        maxPolarAngle={Math.PI / 1.5} 
        minPolarAngle={Math.PI / 3}
      />
    </Canvas>
  );
};
