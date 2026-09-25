// Post-proceso "vision intoxicada": lo que siente la mosca, aplicado a la camara.
export const IntoxShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDrunk: { value: 0 },  // alcohol: ondulacion + vision doble
    uHigh: { value: 0 },   // cocaina/nicotina: aberracion cromatica + saturacion
    uSick: { value: 0 },   // abstinencia/salud baja: desaturado + vineta
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uDrunk, uHigh, uSick;
    varying vec2 vUv;

    vec3 drunkSample(vec2 uv) {
      uv += uDrunk * 0.01 * vec2(sin(uv.y * 8.0 + uTime * 1.7), cos(uv.x * 6.0 + uTime * 1.3));
      vec2 d = uDrunk * 0.016 * vec2(sin(uTime * 0.7), cos(uTime * 0.53));
      vec3 a = texture2D(tDiffuse, uv).rgb;
      vec3 b = 0.5 * (texture2D(tDiffuse, uv + d).rgb + texture2D(tDiffuse, uv - d).rgb);
      return mix(a, b, clamp(uDrunk, 0.0, 1.0) * 0.55);
    }

    void main() {
      vec2 uv = vUv;
      vec3 col = drunkSample(uv);
      if (uHigh > 0.001) {
        vec2 ca = (uv - 0.5) * uHigh * 0.012;
        col.r = drunkSample(uv + ca).r;
        col.b = drunkSample(uv - ca).b;
      }
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.0 + uHigh * 0.7 - uSick * 0.75);
      float r = length(vUv - 0.5) * (1.0 + uSick * 0.5 + uHigh * 0.15 * sin(uTime * 9.0));
      float vig = smoothstep(0.85, 0.25, r);
      col *= mix(1.0, vig, 0.3 + uSick * 0.5);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
