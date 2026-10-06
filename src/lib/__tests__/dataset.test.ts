import { describe, expect, it } from 'vitest';
import { buildExample } from '../dataset';
import type { Attempt } from '../recognize';
import type { ReviewItem } from '../types';

const row = (id: string, amount: number): ReviewItem => ({ id, name: 'Rice', amount, kcal: amount, p: 1, f: 1, c: 20, src: 'estimated', hint: '', save: false, per: { kcal: 1, p: 0, f: 0, c: 0 }, amountSource: 'visual_estimate', nutritionSource: 'generic_db' });
const attempt = (correction: string | null, amount: number): Attempt => ({
  at: '2026-10-06T12:00:00Z',
  correction,
  images: [{ id: 'img_1', kind: 'plate', dataUrl: 'data:image/jpeg;base64,AAAA' }],
  text: 'rice',
  library: [],
  trace: { model: 'm', prompt_sha256: 'abc', commit: null, input_text: 'User note: rice', model_output: { foods: [], unmatched_package_image_ids: [], failure_reason: null } },
  proposed: [row('r1', amount)]
});

describe('training example', () => {
  it('keeps every attempt, each photo once, and the accepted items linked to their proposals', () => {
    const { example, files } = buildExample('ex1', [attempt(null, 150), attempt('it was 200 g', 200)], {
      date: '2026-10-06',
      meal: 'Lunch',
      items: [{ ...row('r1', 220), kcal: 220 }],
      savedIds: ['log1']
    });
    expect(files).toEqual([{ name: 'photo_1.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' }]);
    expect(example.attempts).toHaveLength(2);
    expect(example.attempts[1]).toMatchObject({ correction: 'it was 200 g', input: { images: [{ id: 'img_1', file: 'photo_1.jpg' }] }, proposed: [{ id: 'r1', amount_g: 200 }] });
    expect(example.attempts[0].model).toMatchObject({ name: 'm', input_text: 'User note: rice' });
    expect(example.accepted).toMatchObject({ meal: 'Lunch', items: [{ id: 'r1', amount_g: 220, kcal: 220, log_id: 'log1' }] });
  });
});
