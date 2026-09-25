// Resultado de una tirada de la tragamonedas (logica pura, sin graficos).
// Simbolos: 0 cereza, 1 limon, 2 campana, 3 platano, 4 diamante, 5 mosca, 6 siete.
// Probabilidades base: jackpot 1,2 %, triple 5,8 %, par de cerezas 10 %, casi-acierto 25 %.
// luck > 1 multiplica las probabilidades de premio (suerte de principiante).

export function slotOutcome({ force = null, luck = 1 } = {}) {
  const pJ = 0.012 * luck, pT = 0.058 * luck, pP = 0.1 * luck, pN = 0.25;
  const r = Math.random();
  const notIn = (xs) => { let s; do s = Math.floor(Math.random() * 7); while (xs.includes(s)); return s; };
  let kind = force;
  if (!kind) kind = r < pJ ? 'jackpot' : r < pJ + pT ? 'triple' : r < pJ + pT + pP ? 'pair' : r < pJ + pT + pP + pN ? 'near' : 'lose';
  switch (kind) {
    case 'jackpot': return { res: [6, 6, 6], kind, mult: 30 };
    case 'triple': { const s = Math.floor(Math.random() * 6); return { res: [s, s, s], kind, mult: 5 }; }
    case 'pair': return { res: [0, 0, notIn([0])], kind, mult: 2 };
    case 'near': { const s = [4, 5, 6][Math.floor(Math.random() * 3)]; return { res: [s, s, notIn([s])], kind, mult: 0 }; }
    default: { const a = Math.floor(Math.random() * 7); return { res: [a, notIn([a]), Math.floor(Math.random() * 7)], kind: 'lose', mult: 0 }; }
  }
}
