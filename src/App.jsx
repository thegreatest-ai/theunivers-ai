import React, { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Stars, useTexture, AdaptiveDpr, Preload, useProgress } from '@react-three/drei'
import { EffectComposer, Bloom, DepthOfField, Vignette, Noise, ChromaticAberration } from '@react-three/postprocessing'
import * as THREE from 'three'
import { easing } from 'maath'
import Lenis from 'lenis'
import { scroll } from './scroll'

const TEX = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/planets/'
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const seg = (o, a, b) => clamp01((o - a) / (b - a))
const ss = (t) => t * t * (3 - 2 * t)
const lerp = THREE.MathUtils.lerp
const DOT = (() => { const s = 64, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d')
  const gr = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(220,230,255,.75)'); gr.addColorStop(1, 'rgba(180,200,255,0)')
  g.fillStyle = gr; g.fillRect(0, 0, s, s); return new THREE.CanvasTexture(c) })()

/* ---------- faint distant glow only — real deep space is mostly black ---------- */
function Backdrop() {
  const [neb, neu] = useTexture(['/assets/nebula.jpg', '/assets/neural.jpg'])
  useMemo(() => { [neb, neu].forEach(t => { t.colorSpace = THREE.SRGBColorSpace }) }, [neb, neu])
  const far = useRef(), neuRef = useRef()
  useFrame((state) => {
    const t = state.clock.elapsedTime, o = scroll.offset, fin = ss(seg(o, 0.9, 1))
    // a very faint, slowly drifting glimmer far away — not a painting, just distant colour depth
    if (far.current) {
      far.current.rotation.z = t * 0.003 + fin * 6
      const s = lerp(1.05 + Math.sin(t * 0.06) * 0.03, 0.02, fin); far.current.scale.set(s, s, s)
      far.current.material.opacity = lerp(0.14, 0, ss(seg(o, 0.9, 0.99)))
      far.current.position.set(Math.sin(t * 0.04) * 0.4 - o * 0.9, Math.cos(t * 0.035) * 0.3, lerp(-38, -10, fin))
    }
    if (neuRef.current) { const a = ss(seg(o, 0.3, 0.46)) * (1 - ss(seg(o, 0.6, 0.78))); neuRef.current.material.opacity = a * 0.4; neuRef.current.visible = a > 0.01; neuRef.current.rotation.z = t * 0.02 }
  })
  return (
    <group>
      <mesh ref={far} position={[0, 0, -38]}><planeGeometry args={[140, 80]} /><meshBasicMaterial map={neb} transparent opacity={0.14} depthWrite={false} fog={false} /></mesh>
      <mesh ref={neuRef} position={[0, 0, -17]} visible={false}><planeGeometry args={[44, 25]} /><meshBasicMaterial map={neu} transparent opacity={0} depthWrite={false} fog={false} blending={THREE.AdditiveBlending} /></mesh>
    </group>
  )
}

/* ---------- moving multi-depth starfield = the real "flying through space" background ---------- */
function StarFlow() {
  const nearRef = useRef(), midRef = useRef()
  const mk = (N, spread, depth, spMin, spMax) => {
    const arr = new Float32Array(N * 3), col = new Float32Array(N * 3), st = []
    const w = new THREE.Color('#ffffff'), b = new THREE.Color('#bcd2ff'), v = new THREE.Color('#cdb8ff')
    for (let i = 0; i < N; i++) {
      st.push({ x: (Math.random() - 0.5) * spread, y: (Math.random() - 0.5) * spread * 0.62, z: -Math.random() * depth, sp: spMin + Math.random() * (spMax - spMin) })
      const c = (Math.random() < 0.72 ? w : (Math.random() < 0.5 ? b : v)).clone().multiplyScalar(0.55 + Math.random() * 0.45)
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b
    }
    return { arr, col, st, N, depth, spread }
  }
  const near = useMemo(() => mk(1300, 84, 56, 1.1, 2.8), [])
  const mid = useMemo(() => mk(2600, 116, 72, 0.35, 1.0), [])
  const step = (L, ref, fin, dt) => {
    for (let i = 0; i < L.N; i++) { const p = L.st[i]
      p.z += dt * p.sp * (1 + fin * 8)                       // flow toward camera; rush in at the finale
      if (p.z > 6) { p.z = -L.depth; p.x = (Math.random() - 0.5) * L.spread; p.y = (Math.random() - 0.5) * L.spread * 0.62 }
      L.arr[i*3] = p.x * (1 - fin * 0.92); L.arr[i*3+1] = p.y * (1 - fin * 0.92); L.arr[i*3+2] = p.z
    }
    if (ref.current) ref.current.geometry.attributes.position.needsUpdate = true
  }
  useFrame((_, dt) => { const fin = ss(seg(scroll.offset, 0.9, 1)); step(near, nearRef, fin, dt); step(mid, midRef, fin, dt) })
  return (
    <group>
      <points ref={nearRef}><bufferGeometry><bufferAttribute attach="attributes-position" array={near.arr} count={near.N} itemSize={3} /><bufferAttribute attach="attributes-color" array={near.col} count={near.N} itemSize={3} /></bufferGeometry>
        <pointsMaterial size={0.085} map={DOT} vertexColors transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation /></points>
      <points ref={midRef}><bufferGeometry><bufferAttribute attach="attributes-position" array={mid.arr} count={mid.N} itemSize={3} /><bufferAttribute attach="attributes-color" array={mid.col} count={mid.N} itemSize={3} /></bufferGeometry>
        <pointsMaterial size={0.05} map={DOT} vertexColors transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation /></points>
    </group>
  )
}

/* ---------- real 3D Earth ---------- */
function Earth() {
  const [map, clouds, normal, spec] = useTexture([TEX + 'earth_atmos_2048.jpg', TEX + 'earth_clouds_1024.png', TEX + 'earth_normal_2048.jpg', TEX + 'earth_specular_2048.jpg'])
  useMemo(() => { [map, clouds, normal, spec].forEach(t => { t.anisotropy = 8 }) }, [map, clouds, normal, spec])
  const grp = useRef(), earth = useRef(), cloud = useRef()
  const c = useRef({ x: 1.9, y: -1.7, z: 0, s: 1.7, op: 1 })
  useFrame((_, dt) => {
    const o = scroll.offset
    if (earth.current) earth.current.rotation.y += dt * 0.05
    if (cloud.current) cloud.current.rotation.y += dt * 0.07
    let x = 0, y = 0, z = 0, s = 1, op = 1
    if (o < 0.09) { const t = ss(o / 0.09); x = lerp(1.9, 0, t); y = lerp(-1.7, 0, t); s = lerp(1.7, 1, t) }
    else if (o < 0.28) { const t = ss((o - 0.09) / 0.19); z = lerp(0, -1.4, t); s = lerp(1, 0.62, t) }
    else if (o < 0.42) { const t = ss((o - 0.28) / 0.14); z = lerp(-1.4, 0.2, t); s = lerp(0.62, 0.45, t); op = lerp(1, 0, t) }
    else { z = 0.2; s = 0.45; op = 0 }
    const r = c.current; r.x = lerp(r.x, x, 0.12); r.y = lerp(r.y, y, 0.12); r.z = lerp(r.z, z, 0.12); r.s = lerp(r.s, s, 0.12); r.op = lerp(r.op, op, 0.15)
    if (grp.current) { grp.current.position.set(r.x, r.y, r.z); grp.current.scale.setScalar(r.s); grp.current.visible = r.op > 0.01 }
    if (earth.current) earth.current.material.opacity = r.op
    if (cloud.current) cloud.current.material.opacity = r.op * 0.9
  })
  return (
    <group ref={grp}>
      <mesh ref={earth}><sphereGeometry args={[2, 128, 128]} /><meshStandardMaterial map={map} normalMap={normal} roughnessMap={spec} metalness={0.1} roughness={0.85} transparent /></mesh>
      <mesh ref={cloud} scale={1.012}><sphereGeometry args={[2, 96, 96]} /><meshStandardMaterial map={clouds} transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      <mesh scale={1.16}><sphereGeometry args={[2, 48, 48]} /><shaderMaterial transparent blending={THREE.AdditiveBlending} side={THREE.BackSide}
        uniforms={{ c: { value: new THREE.Color('#3b82f6') } }}
        vertexShader={`varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`}
        fragmentShader={`varying vec3 vN; uniform vec3 c; void main(){ float i=pow(0.62-dot(vN,vec3(0.,0.,1.)),3.0); gl_FragColor=vec4(c,1.)*i; }`} /></mesh>
    </group>
  )
}

/* ---------- glowing neural-network planet ---------- */
function NeuronPlanet() {
  const grp = useRef()
  const { nodePos, linePos, edges } = useMemo(() => {
    const N = 360, R = 2.6, pts = [], ga = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), t = ga * i; pts.push(new THREE.Vector3(Math.cos(t) * r * R, y * R, Math.sin(t) * r * R)) }
    const edges = [], lp = []
    for (let i = 0; i < N; i++) { const d = []; for (let j = 0; j < N; j++) if (i !== j) d.push([pts[i].distanceTo(pts[j]), j]); d.sort((a, b) => a[0] - b[0])
      for (let k = 0; k < 2; k++) { const j = d[k][1]; if (j > i) { edges.push([pts[i], pts[j]]); lp.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z) } } }
    const np = new Float32Array(N * 3); pts.forEach((v, i) => { np[i*3]=v.x; np[i*3+1]=v.y; np[i*3+2]=v.z })
    return { nodePos: np, linePos: new Float32Array(lp), edges }
  }, [])
  const PN = 90, pulses = useMemo(() => Array.from({ length: PN }, () => ({ e: (Math.random()*edges.length)|0, t: Math.random(), sp: .4+Math.random()*.8 })), [edges])
  const pulseRef = useRef(), pArr = useMemo(() => new Float32Array(PN * 3), []), lineMat = useRef(), nodeMat = useRef()
  useFrame((_, dt) => {
    const o = scroll.offset
    let s = 0.001, op = 0
    if (o < 0.28) { s = 0.001; op = 0 }
    else if (o < 0.45) { const t = ss((o - 0.28) / 0.17); s = lerp(0.2, 1, t); op = t }
    else if (o < 0.55) { const t = ss((o - 0.45) / 0.10); s = 1; op = lerp(1, 0, t) }
    else { s = 1; op = 0 }                              // stays gone after its stage — no finale reappearance
    if (grp.current) { grp.current.rotation.y += dt * 0.04; grp.current.scale.setScalar(s); grp.current.visible = op > 0.01
      if (lineMat.current) lineMat.current.opacity = 0.2 * op; if (nodeMat.current) nodeMat.current.opacity = 0.98 * op }
    for (let i = 0; i < PN; i++) { const p = pulses[i]; p.t += dt * p.sp; if (p.t > 1) { p.t = 0; p.e = (Math.random()*edges.length)|0 }
      const [a, b] = edges[p.e]; pArr[i*3]=lerp(a.x,b.x,p.t); pArr[i*3+1]=lerp(a.y,b.y,p.t); pArr[i*3+2]=lerp(a.z,b.z,p.t) }
    if (pulseRef.current) pulseRef.current.geometry.attributes.position.needsUpdate = true
  })
  return (
    <group ref={grp} scale={0.001}>
      <points><bufferGeometry><bufferAttribute attach="attributes-position" array={nodePos} count={nodePos.length/3} itemSize={3} /></bufferGeometry>
        <pointsMaterial ref={nodeMat} size={0.07} map={DOT} color={'#9fe0ff'} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation /></points>
      <lineSegments><bufferGeometry><bufferAttribute attach="attributes-position" array={linePos} count={linePos.length/3} itemSize={3} /></bufferGeometry>
        <lineBasicMaterial ref={lineMat} color={'#4a90ff'} transparent opacity={0} blending={THREE.AdditiveBlending} /></lineSegments>
      <points ref={pulseRef}><bufferGeometry><bufferAttribute attach="attributes-position" array={pArr} count={PN} itemSize={3} /></bufferGeometry>
        <pointsMaterial size={0.14} map={DOT} color={'#eaf6ff'} transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation /></points>
    </group>
  )
}

/* ---------- black hole: a clean void that swallows everything into black ---------- */
function BlackHole() {
  const grp = useRef(), ringMat = useRef()
  useFrame(() => {
    const o = scroll.offset, appear = ss(seg(o, 0.88, 0.94))
    const grow = 1 + ss(seg(o, 0.9, 1)) * 1.4          // void expands as it pulls everything in
    const fade = 1 - ss(seg(o, 0.95, 1))                // rim fades out at the very end → pure black
    if (grp.current) { grp.current.scale.setScalar(lerp(0.001, grow, appear)); grp.current.visible = appear > 0.002 }
    if (ringMat.current) ringMat.current.opacity = appear * 0.6 * fade
  })
  return (
    <group ref={grp} scale={0.001}>
      <mesh><sphereGeometry args={[1.7, 64, 64]} /><meshBasicMaterial color={'#000000'} /></mesh>
      <mesh><ringGeometry args={[1.7, 1.82, 220]} /><meshBasicMaterial ref={ringMat} color={'#cfe0ff'} side={THREE.DoubleSide} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </group>
  )
}

function MilkyWay() {
  const ref = useRef(), mat = useRef()
  const { pos, col } = useMemo(() => {
    const M = 6000, pos = new Float32Array(M * 3), col = new Float32Array(M * 3)
    const cIn = new THREE.Color('#fff0d8'), cMid = new THREE.Color('#9fc0ff'), cOut = new THREE.Color('#9b5cff')
    for (let i = 0; i < M; i++) {
      const arm = (i % 4) * (Math.PI / 2), rad = Math.pow(Math.random(), 0.7) * 9 + 1.4, a = arm + rad * 0.42 + (Math.random() - 0.5) * 0.7
      pos[i*3] = Math.cos(a) * rad + (Math.random() - 0.5) * 1.1; pos[i*3+1] = (Math.random() - 0.5) * 0.7 * (1 - rad / 12); pos[i*3+2] = Math.sin(a) * rad + (Math.random() - 0.5) * 1.1
      const cc = cIn.clone().lerp(cMid, Math.min(rad / 5, 1)).lerp(cOut, Math.max(0, rad / 10 - 0.4)); col[i*3]=cc.r; col[i*3+1]=cc.g; col[i*3+2]=cc.b
    }
    return { pos, col }
  }, [])
  useFrame((_, dt) => {
    const o = scroll.offset, ap = ss(seg(o, 0.79, 0.89)), suck = ss(seg(o, 0.92, 1))
    if (ref.current) { ref.current.rotation.y += dt * 0.06; ref.current.scale.setScalar(lerp(1, 0.04, suck)); ref.current.visible = ap > 0.01 }
    if (mat.current) mat.current.opacity = ap * 0.5 * (1 - suck * 0.7)
  })
  return (
    <points ref={ref} rotation={[-0.95, 0, 0]} visible={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" array={pos} count={pos.length/3} itemSize={3} /><bufferAttribute attach="attributes-color" array={col} count={col.length/3} itemSize={3} /></bufferGeometry>
      <pointsMaterial ref={mat} size={0.06} map={DOT} vertexColors transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
    </points>
  )
}

function FallingStars() {
  const ref = useRef(), mat = useRef()
  const N = 1300, Z0 = 9
  const { arr, col, st } = useMemo(() => {
    const arr = new Float32Array(N * 3), col = new Float32Array(N * 3), st = []
    const cA = new THREE.Color('#e6eeff'), cB = new THREE.Color('#aab8e8')
    for (let i = 0; i < N; i++) { st.push({ z: Math.random() * Z0, br: 0.8 + Math.random() * 9, a: Math.random() * Math.PI * 2, sp: 0.4 + Math.random() * 0.6 })
      const cc = (Math.random() < 0.85 ? cA : cB); col[i*3]=cc.r; col[i*3+1]=cc.g; col[i*3+2]=cc.b }
    return { arr, col, st }
  }, [])
  useFrame((_, dt) => {
    const o = scroll.offset, ap = ss(seg(o, 0.84, 1)), suck = ss(seg(o, 0.9, 1))
    if (ref.current) ref.current.visible = ap > 0.01
    if (mat.current) mat.current.opacity = ap * 0.85
    for (let i = 0; i < N; i++) { const p = st[i]
      p.z -= dt * p.sp * (0.35 + ap + suck * 2.8) * (0.5 + (Z0 - p.z) / Z0)   // rush into the hole at the finale
      if (p.z < 0.18) { p.z = Z0; p.br = 0.8 + Math.random() * 9; p.a = Math.random() * Math.PI * 2 }
      const rad = p.br * (p.z / Z0)
      arr[i*3] = Math.cos(p.a) * rad; arr[i*3+1] = Math.sin(p.a) * rad; arr[i*3+2] = p.z
    }
    if (ref.current) ref.current.geometry.attributes.position.needsUpdate = true
  })
  return (
    <points ref={ref} visible={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" array={arr} count={N} itemSize={3} /><bufferAttribute attach="attributes-color" array={col} count={N} itemSize={3} /></bufferGeometry>
      <pointsMaterial ref={mat} size={0.05} map={DOT} vertexColors transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
    </points>
  )
}

function ConnectBurst() {
  const ref = useRef(), mat = useRef()
  const N = 700
  const { arr, dir, jit } = useMemo(() => {
    const arr = new Float32Array(N * 3), dir = [], jit = new Float32Array(N)
    const ga = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), t = ga * i
      dir.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r)); jit[i] = 0.82 + ((i * 0.6180339) % 1) * 0.42 }
    return { arr, dir, jit }
  }, [])
  useFrame((_, dt) => {
    const o = scroll.offset
    const gather = ss(seg(o, 0.15, 0.23))
    const expand = ss(seg(o, 0.25, 0.35))
    const op = ss(seg(o, 0.10, 0.14)) * (1 - ss(seg(o, 0.31, 0.38)))
    const base = lerp(0.015, 1.85, gather) + expand * 2.9
    for (let i = 0; i < N; i++) { const d = dir[i], r = base * (gather > 0.02 ? jit[i] : 1)
      arr[i*3] = d.x * r; arr[i*3+1] = d.y * r; arr[i*3+2] = d.z * r }
    if (ref.current) { ref.current.geometry.attributes.position.needsUpdate = true; ref.current.rotation.y += dt * 0.14; ref.current.visible = op > 0.01 }
    if (mat.current) mat.current.opacity = op
  })
  return (
    <points ref={ref} position={[0, 0, -0.5]} visible={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" array={arr} count={N} itemSize={3} /></bufferGeometry>
      <pointsMaterial ref={mat} size={0.06} map={DOT} color={'#cfe6ff'} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
    </points>
  )
}

/* ---------- the whole universe spiralling into the black hole (scroll-driven) ---------- */
function Vortex() {
  const ref = useRef(), mat = useRef()
  const N = 5000
  const { arr, st, col } = useMemo(() => {
    const arr = new Float32Array(N * 3), col = new Float32Array(N * 3), st = []
    const cA = new THREE.Color('#dbe7ff'), cB = new THREE.Color('#9b5cff'), cC = new THREE.Color('#38bdf8')
    for (let i = 0; i < N; i++) {
      const r = 3 + Math.pow(Math.random(), 0.6) * 17, a = Math.random() * Math.PI * 2, z = -2 - Math.random() * 24
      st.push({ r, a, z })
      const c = (Math.random() < 0.6 ? cA : (Math.random() < 0.5 ? cB : cC)); col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b
    }
    return { arr, st, col }
  }, [])
  useFrame(() => {
    const o = scroll.offset
    if (o < 0.86) { if (ref.current) ref.current.visible = false; return }   // idle until the finale
    const vis = ss(seg(o, 0.88, 0.95))
    const p = ss(seg(o, 0.9, 1))                          // suck-in progress, scroll-driven
    if (ref.current) ref.current.visible = vis > 0.01
    if (mat.current) mat.current.opacity = vis * (1 - ss(seg(o, 0.97, 1))) * 0.95
    for (let i = 0; i < N; i++) { const s = st[i]
      const r = s.r * Math.pow(1 - p, 1.7)                // collapse inward, accelerating
      const a = s.a + p * 7.0 * (1 + s.r * 0.03)          // swirl as it falls in
      arr[i*3] = Math.cos(a) * r
      arr[i*3+1] = Math.sin(a) * r * 0.7
      arr[i*3+2] = lerp(s.z, 0, p)                        // drawn toward the hole at the centre
    }
    if (ref.current) ref.current.geometry.attributes.position.needsUpdate = true
  })
  return (
    <points ref={ref} visible={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" array={arr} count={N} itemSize={3} /><bufferAttribute attach="attributes-color" array={col} count={N} itemSize={3} /></bufferGeometry>
      <pointsMaterial ref={mat} size={0.07} map={DOT} vertexColors transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
    </points>
  )
}

/* ---------- cinematic camera: intro dolly → scroll-driven orbit/dolly/fall ---------- */
function CameraRig() {
  const intro = useRef(0)
  const tgt = useMemo(() => new THREE.Vector3(), [])
  const from = useMemo(() => new THREE.Vector3(), [])
  const bo = useRef(null), els = useRef(null)
  useFrame((state, dt) => {
    const o = scroll.offset
    // collapse the whole background to pure black as everything is pulled in
    if (!bo.current) bo.current = document.getElementById('blackout')
    if (bo.current) bo.current.style.opacity = '' + ss(seg(o, 0.93, 0.999))
    // finale content revealed by the last scroll — headline fades + zooms in, then logos, then the rest
    if (!els.current) {
      const wrap = document.getElementById('finale')
      if (wrap) els.current = { wrap, hl: wrap.querySelector('h2'), logos: wrap.querySelector('.socials'), brand: wrap.querySelector('.brandblock'), made: wrap.querySelector('.made') }
    }
    const F = els.current
    if (F) {
      F.wrap.style.visibility = o > 0.9 ? 'visible' : 'hidden'
      if (F.hl) { F.hl.style.opacity = '' + ss(seg(o, 0.92, 0.99)); F.hl.style.transform = `scale(${lerp(0.55, 1, ss(seg(o, 0.92, 1)))})` }
      if (F.logos) F.logos.style.opacity = '' + ss(seg(o, 0.95, 1))
      if (F.brand) F.brand.style.opacity = '' + ss(seg(o, 0.965, 1))
      if (F.made) F.made.style.opacity = '' + ss(seg(o, 0.985, 1))
    }
    intro.current = Math.min(1, intro.current + dt / 2.6)
    const e = 1 - Math.pow(1 - intro.current, 3)
    const fin = ss(seg(o, 0.9, 1))                          // finale: the whole view is pulled INTO the hole
    // dolly in on Earth, hold mid-field, then DIVE straight into the singularity (no zoom-out)
    let z = lerp(5.4, 7.0, ss(seg(o, 0, 0.42)))
    z = lerp(z, 1.92, fin * fin)                            // accelerating suck-in toward the void
    // orbit weave + crane — damped to zero as we fall in, so we fly dead-straight into the centre
    const orbit = ss(seg(o, 0.05, 0.7)) * (1 - fin)
    let x = Math.sin(o * Math.PI * 3.0) * 0.8 * orbit
    let y = lerp(0.12, 0.45, ss(seg(o, 0.46, 0.7))) * (1 - fin)
    x += state.pointer.x * 0.45 * (1 - fin)                 // live pointer parallax (off during the dive)
    y += -state.pointer.y * 0.32 * (1 - fin)
    const fov = lerp(40, 66, fin)                           // strong vertigo as everything is pulled in
    tgt.set(x, y, Math.max(z, 1.9))
    if (intro.current < 1) { from.set(x, y + 3.4, 32); state.camera.position.lerpVectors(from, tgt, e) }
    else { easing.damp3(state.camera.position, tgt, 0.4, dt) }
    if (Math.abs(state.camera.fov - fov) > 0.01) { state.camera.fov += (fov - state.camera.fov) * 0.08; state.camera.updateProjectionMatrix() }
    state.camera.lookAt(0, 0, 0)
  })
  return null
}

function Scene() {
  const caOffset = useMemo(() => new THREE.Vector2(0.0006, 0.0009), [])
  return (
    <>
      <color attach="background" args={['#04050c']} /><fog attach="fog" args={['#04050c', 12, 40]} />
      <ambientLight intensity={0.38} /><directionalLight position={[5, 3, 5]} intensity={2.4} color={'#fff4e6'} /><pointLight position={[-6, -2, 3]} intensity={26} color={'#9b5cff'} />
      <Backdrop /><StarFlow />
      <Vortex /><ConnectBurst />
      <Earth /><NeuronPlanet />
      <Environment preset="night" />
      <Stars radius={90} depth={50} count={1300} factor={2.3} saturation={0} fade speed={0.4} />
      <CameraRig />
      <EffectComposer disableNormalPass>
        <Bloom mipmapBlur intensity={0.72} luminanceThreshold={0.24} luminanceSmoothing={0.85} radius={0.78} />
        <ChromaticAberration offset={caOffset} />
        <DepthOfField focusDistance={0.012} focalLength={0.045} bokehScale={3} />
        <Vignette offset={0.3} darkness={0.9} /><Noise opacity={0.03} />
      </EffectComposer>
    </>
  )
}

/* ====================== DOM overlay ====================== */
function StarMark() {
  return (<svg viewBox="0 0 100 100" width="28" height="28" aria-hidden>
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#9b5cff" /></linearGradient></defs>
    <path fill="url(#g)" d="M50 2 L55.4 37.1 L71.2 28.8 L62.9 44.6 L98 50 L62.9 55.4 L71.2 71.2 L55.4 62.9 L50 98 L44.6 62.9 L28.8 71.2 L37.1 55.4 L2 50 L37.1 44.6 L28.8 28.8 L44.6 37.1 Z" /></svg>)
}

const SOCIALS = [
  ['Instagram', '#', 'M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zm0 2.76a7.08 7.08 0 1 0 0 14.16 7.08 7.08 0 0 0 0-14.16zm0 1.62a5.3 5.3 0 1 1 0 10.6 5.3 5.3 0 0 1 0-10.6zm5.5-2.9a1.24 1.24 0 1 1 0 2.48 1.24 1.24 0 0 1 0-2.48z'],
  ['X', '#', 'M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.81-5.96 6.81H1.69l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23zm-1.16 17.52h1.83L7.01 4.12H5.05l12.03 15.65z'],
  ['LinkedIn', '#', 'M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z'],
  ['TikTok', '#', 'M16.6 5.82a4.28 4.28 0 0 1-1.06-2.82h-3.2v12.4a2.46 2.46 0 1 1-2.46-2.46c.27 0 .53.04.78.12V9.79a5.66 5.66 0 1 0 4.88 5.6V9.01a7.5 7.5 0 0 0 4.38 1.4V7.21a4.28 4.28 0 0 1-3.32-1.39z'],
  ['Facebook', '#', 'M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.69.24 2.69.24v2.95h-1.51c-1.49 0-1.96.93-1.96 1.87V12h3.33l-.53 3.47h-2.8v8.38A12 12 0 0 0 24 12z'],
  ['WhatsApp', 'https://wa.me/971501781715', 'M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.18-1.36a9.93 9.93 0 0 0 4.86 1.24c5.5 0 9.96-4.46 9.96-9.96S17.54 2 12.04 2zm5.55 13.93c-.21.58-1.2 1.11-1.68 1.18-.43.06-.97.09-1.56-.1-.36-.11-.82-.26-1.41-.52-2.48-1.07-4.1-3.58-4.23-3.74-.12-.16-1.01-1.34-1.01-2.56 0-1.22.63-1.82.86-2.07.23-.25.5-.31.66-.31h.48c.15.01.36-.05.56.43.21.5.71 1.72.77 1.85.06.12.1.27.02.43-.08.16-.12.27-.25.41-.12.14-.26.32-.37.43-.13.12-.25.26-.11.51.14.25.64 1.06 1.38 1.72.95.84 1.75 1.1 2 1.23.25.12.4.1.54-.06.15-.17.63-.72.79-.97.15-.26.31-.21.56-.13.23.08 1.45.68 1.7.81.25.08.41.14.47.28.06.11.06.6-.14 1.18z'],
]
function Socials() { return (<div className="socials">{SOCIALS.map(([n, h, d]) => (<a key={n} href={h} target="_blank" rel="noreferrer" aria-label={n} title={n}><svg viewBox="0 0 24 24"><path d={d} /></svg></a>))}</div>) }

const go = (id) => window.__lenis?.scrollTo('#' + id, { duration: 1.6 })

function useInView(threshold = 0.32) {
  const ref = useRef(null), [v, setV] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setV(true) }, { threshold })
    io.observe(el); return () => io.disconnect()
  }, [threshold])
  return [ref, v]
}

function Act({ id, align = 'center', children }) {
  const [ref, v] = useInView()
  return <section id={id} ref={ref} className={`act ${align} ${v ? 'in' : ''}`}>{children}</section>
}

function Overlay() {
  const [showContact, setShowContact] = useState(false)
  const [sent, setSent] = useState(false)
  return (
    <div className="scroll-content">
      <header className="nav">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); window.__lenis?.scrollTo(0, { duration: 1.4 }) }}><StarMark /><span className="brand-name">theunivers<i>.ai</i></span></a>
        <nav className="nav-links"><span onClick={() => go('act-services')}>Services</span><span onClick={() => go('act-vision')}>Vision</span><a className="pill" href="/app/join">Get started</a></nav>
      </header>

      <Act id="act-hero" align="left">
        <p className="eyebrow">theunivers.ai</p>
        <h1>Connect <span className="grad">both worlds</span></h1>
        <p className="lede">The human world, meet the AI world.</p>
        <a className="pill solid" href="/app/signin">Enter private pilot ✦</a>
        <div className="scroll-cue"><span /></div>
      </Act>

      <Act id="act-gap" align="center"><h2>Every day, hours and budget<br />slip into work <span className="grad">AI can already do</span></h2></Act>

      <Act id="act-services" align="left">
        <p className="kicker">What we do</p><h2>We connect you to it</h2>
        <div className="forces"><div><b>Engagement</b><span>Content & campaigns that grow your audience</span></div><div><b>Automation</b><span>AI agents that handle the busywork, 24/7</span></div><div><b>Systems</b><span>Custom AI built around how you work</span></div></div>
      </Act>

      <Act id="act-results" align="right">
        <p className="kicker">The results</p><h2>Up to <span className="grad">80%</span> less time<br />Up to <span className="grad">60%</span> lower cost</h2><p className="lede">Done for you — working from day one.</p>
      </Act>

      <Act id="act-fusion" align="center"><h2>Two worlds,<br /><span className="grad">one intelligence</span></h2><p className="lede">Human creativity and machine precision — fused.</p></Act>

      <Act id="act-vision" align="center">
        <p className="kicker">The nation's vision</p>
        <blockquote className="quote">"Technology must serve people and enhance quality of life."<cite>— H.H. Sheikh Mohammed bin Rashid Al Maktoum</cite></blockquote>
        <blockquote className="quote">"The future belongs to those who can imagine it, design it, and execute it."<cite>— H.H. Sheikh Mohammed bin Rashid Al Maktoum</cite></blockquote>
      </Act>

      <Act id="act-join" align="center">
        <p className="kicker">Connect</p><h2>Join <span className="grad">theunivers</span></h2>
        {/* The in-page register panel is gone. It had Google, Facebook and Apple buttons that did
            nothing and a "Create account" that only advanced the scroll — a convincing fake that
            photographs well and fails the first visitor who tries it. Real sign-in now exists at
            /app/signin, so the marketing site's job here is to hand over, not to imitate. */}
        <p className="lede" style={{ textAlign: 'center', margin: '0 auto' }}>
          Deploy an agent that carries your terms into the market, and refuses the ones you did not agree.
        </p>
        <a className="pill solid" href="/app/join">Get started ✦</a>
        <p className="made" style={{ letterSpacing: '.04em', textTransform: 'none', marginTop: 6 }}>
          Private pilot · invite required
        </p>
      </Act>

      <Act id="act-welcome" align="center">
        <p className="kicker">Your world</p><h2>Talk to us</h2>
        {!showContact ? <button className="pill solid" onClick={() => setShowContact(true)}>Contact us ✦</button>
        : sent ? <div className="panel pop"><div className="success"><div className="tick">✓</div><h3>Sent.</h3><p>We'll reach you on WhatsApp shortly.</p></div></div>
        : <div className="panel pop"><form onSubmit={(e) => { e.preventDefault(); setSent(true) }}>
            <input type="email" placeholder="Email" required /><input type="text" placeholder="Tell us what you need" /><button className="pill solid full" type="submit">Send ✦</button></form></div>}
      </Act>

      {/* scroll room for the finale */}
      <section className="spacer-finale" />
      {/* finale content — pinned to screen centre, revealed in place by the last scroll */}
      <div className="finale" id="finale">
        <h2>Into <span className="grad">the singularity</span></h2>
        <Socials />
        <div className="brandblock"><span className="brand-name big">theunivers<i>.ai</i></span><span className="designed">designed by thegreatest.ai</span></div>
        <span className="made">MADE IN UAE</span>
      </div>
    </div>
  )
}

function Preloader() {
  const { progress, active } = useProgress()
  const [hide, setHide] = useState(false)
  const [minDone, setMinDone] = useState(false)
  useEffect(() => { const t = setTimeout(() => setMinDone(true), 1500); return () => clearTimeout(t) }, [])
  useEffect(() => { if (minDone && !active && progress >= 100) { const t = setTimeout(() => setHide(true), 500); return () => clearTimeout(t) } }, [minDone, active, progress])
  return (
    <div className={`preloader ${hide ? 'done' : ''}`}>
      <div className="pl-mark"><StarMark /><span>theunivers<i>.ai</i></span></div>
      <div className="pl-bar"><span style={{ transform: `scaleX(${Math.min(progress, 100) / 100})` }} /></div>
      <div className="pl-pct">{Math.round(Math.min(progress, 100))}</div>
    </div>
  )
}

function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.08, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.5, syncTouch: false, autoRaf: false })
    window.__lenis = lenis
    let raf
    const loop = (t) => { lenis.raf(t); scroll.offset = lenis.progress || 0; scroll.vel = lenis.velocity || 0; raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); lenis.destroy(); window.__lenis = null }
  }, [])
  return null
}

export default function App() {
  return (
    <>
      <Preloader />
      <SmoothScroll />
      <div className="canvas-fixed">
        <Canvas dpr={[1, 2]} camera={{ position: [0, 3.4, 32], fov: 40 }} gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.12 }}>
          <Suspense fallback={null}><Scene /><Preload all /></Suspense>
          <AdaptiveDpr pixelated />
        </Canvas>
      </div>
      <div className="blackout" id="blackout" />
      <Overlay />
    </>
  )
}
