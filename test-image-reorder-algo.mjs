#!/usr/bin/env node
// Unit test for the batched image-reorder algorithm.
// Simulates Etsy's swap semantics: setting image X to rank R puts X at R and
// places whatever was at R into X's old slot. Verifies that after applying our
// computed PUT sequence, the resulting state is a contiguous 1..N permutation
// matching the user's intent.

function applyMoves(initial, moves) {
  // moves: [{ etsyMediaId, targetRank }], applied as Etsy swaps.
  const byId = new Map(initial.map((img) => [String(img.listing_image_id), { ...img }]));
  for (const m of moves) {
    const me = byId.get(m.etsyMediaId);
    if (!me) throw new Error(`unknown image ${m.etsyMediaId}`);
    const oldRank = me.rank;
    const targetRank = m.targetRank;
    if (oldRank === targetRank) continue;
    // Find what's currently at targetRank
    let displaced = null;
    for (const img of byId.values()) {
      if (img.rank === targetRank && String(img.listing_image_id) !== m.etsyMediaId) {
        displaced = img;
        break;
      }
    }
    me.rank = targetRank;
    if (displaced) displaced.rank = oldRank;
  }
  return [...byId.values()].sort((a, b) => a.rank - b.rank);
}

function computeBatch(initial, reorderOps) {
  const ordered = [...initial].sort((a, b) => (a.rank || 0) - (b.rank || 0));
  for (const op of reorderOps) {
    const idx = ordered.findIndex((img) => String(img.listing_image_id) === String(op.etsyMediaId));
    if (idx === -1) continue;
    const [moved] = ordered.splice(idx, 1);
    const target = Math.max(0, Math.min(ordered.length, (Number(op.rank) || 1) - 1));
    ordered.splice(target, 0, moved);
  }
  const moves = [];
  for (let i = 0; i < ordered.length; i++) {
    const targetRank = i + 1;
    if (Number(ordered[i].rank) !== targetRank) {
      moves.push({ etsyMediaId: String(ordered[i].listing_image_id), targetRank, intendedFinal: ordered.map((x) => String(x.listing_image_id)) });
    }
  }
  moves.sort((a, b) => b.targetRank - a.targetRank);
  return { moves, expectedFinal: ordered.map((x) => String(x.listing_image_id)) };
}

function validateContiguous(images) {
  const ranks = images.map((i) => i.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return false;
  }
  return true;
}

const cases = [
  {
    name: 'simple swap (1 ↔ 2)',
    initial: [{ listing_image_id: 'A', rank: 1 }, { listing_image_id: 'B', rank: 2 }, { listing_image_id: 'C', rank: 3 }],
    ops: [{ etsyMediaId: 'A', rank: 2 }],
    expected: ['B', 'A', 'C'],
  },
  {
    name: 'move first to last (1 → 5)',
    initial: [...'ABCDE'].map((id, i) => ({ listing_image_id: id, rank: i + 1 })),
    ops: [{ etsyMediaId: 'A', rank: 5 }],
    expected: ['B', 'C', 'D', 'E', 'A'],
  },
  {
    name: 'cycle: A→2, B→3, C→1 (was A→1, B→2, C→3)',
    initial: [{ listing_image_id: 'A', rank: 1 }, { listing_image_id: 'B', rank: 2 }, { listing_image_id: 'C', rank: 3 }],
    ops: [{ etsyMediaId: 'A', rank: 2 }, { etsyMediaId: 'C', rank: 1 }],
    // After splice simulation: start [A,B,C]. A→idx1 [B,A,C]. C→idx0 [C,B,A]
    expected: ['C', 'B', 'A'],
  },
  {
    name: 'no-op (already in place)',
    initial: [{ listing_image_id: 'A', rank: 1 }, { listing_image_id: 'B', rank: 2 }],
    ops: [{ etsyMediaId: 'A', rank: 1 }],
    expected: ['A', 'B'],
  },
  {
    name: 'permutation involving 4 images',
    initial: [...'ABCDE'].map((id, i) => ({ listing_image_id: id, rank: i + 1 })),
    ops: [
      { etsyMediaId: 'E', rank: 1 },  // E moves to position 1
      { etsyMediaId: 'A', rank: 5 },  // A moves to position 5
    ],
    // splice: [A,B,C,D,E]; E→0 [E,A,B,C,D]; A→4 [E,B,C,D,A]
    expected: ['E', 'B', 'C', 'D', 'A'],
  },
];

let passed = 0, failed = 0;
for (const tc of cases) {
  const { moves, expectedFinal } = computeBatch(tc.initial, tc.ops);
  const simulated = applyMoves(tc.initial, moves);
  const finalIds = simulated.map((x) => String(x.listing_image_id));
  const contiguous = validateContiguous(simulated);
  const matchesExpected = finalIds.join(',') === tc.expected.join(',');
  const matchesPlan = finalIds.join(',') === expectedFinal.join(',');

  if (contiguous && matchesExpected && matchesPlan) {
    passed++;
    console.log(`  PASS — ${tc.name}: ${finalIds.join(',')} (${moves.length} PUTs)`);
  } else {
    failed++;
    console.log(`  FAIL — ${tc.name}`);
    console.log(`         expected order:    ${tc.expected.join(',')}`);
    console.log(`         simulated order:   ${finalIds.join(',')}`);
    console.log(`         batch plan order:  ${expectedFinal.join(',')}`);
    console.log(`         contiguous ranks:  ${contiguous}`);
    console.log(`         moves:             ${JSON.stringify(moves)}`);
    console.log(`         simulated ranks:   ${JSON.stringify(simulated.map(x => `${x.listing_image_id}=${x.rank}`))}`);
  }
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed > 0 ? 1 : 0);
