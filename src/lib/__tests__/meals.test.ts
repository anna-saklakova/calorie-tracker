import { beforeEach, describe, expect, it } from 'vitest';
import { mealLabels } from '../nutrition';
import { addItems, getData, saveItem, setData } from '../store';
import { emptyData } from '../types';
import type { Item } from '../types';

const D = '2026-10-06';
const item = (id: string): Item => ({ id, name: id, amount: 100, kcal: 100, p: 1, f: 1, c: 1 });
const meals = () => getData().days[D].meals;

describe('snacks and moving items', () => {
  beforeEach(() => setData(emptyData()));

  it('names one snack "Snack" and numbers them once there are more', () => {
    addItems(D, 'Snack', [item('a')]);
    expect(Object.values(mealLabels(meals()))).toEqual(['Snack']);
    addItems(D, 'Lunch', [item('b')]);
    addItems(D, 'Snack', [item('c')]);
    expect(meals().map(m => mealLabels(meals())[m.id])).toEqual(['Lunch', 'Snack 1', 'Snack 2']);
  });

  it('adds to an existing snack when one is picked, else starts a new one', () => {
    addItems(D, 'Snack', [item('a')]);
    const first = meals()[0].id;
    addItems(D, 'Snack', [item('b')], first);
    expect(meals()).toHaveLength(1);
    expect(meals()[0].items.map(i => i.id)).toEqual(['a', 'b']);
    addItems(D, 'Snack', [item('c')]);
    expect(meals()).toHaveLength(2);
  });

  it('moves an edited item to another meal and drops the emptied one', () => {
    addItems(D, 'Breakfast', [item('a')]);
    addItems(D, 'Dinner', [item('b')]);
    saveItem(D, meals()[0].id, { ...item('a'), name: 'eggs' }, 'Dinner');
    expect(meals()).toHaveLength(1);
    expect(meals()[0]).toMatchObject({ type: 'Dinner' });
    expect(meals()[0].items.map(i => i.name)).toEqual(['b', 'eggs']);
  });

  it('moves an item between snacks and out into a new one', () => {
    addItems(D, 'Snack', [item('a'), item('b')]);
    addItems(D, 'Snack', [item('c')]);
    const [s1, s2] = meals().map(m => m.id);
    saveItem(D, s1, item('b'), 'Snack', s2);
    expect(meals().map(m => m.items.map(i => i.id))).toEqual([['a'], ['c', 'b']]);
    saveItem(D, s2, item('c'), 'Snack');
    expect(meals().map(m => m.items.map(i => i.id))).toEqual([['a'], ['b'], ['c']]);
    // alone in its snack and "new snack" picked: it stays where it is
    const last = meals()[2].id;
    saveItem(D, last, { ...item('c'), amount: 50 }, 'Snack');
    expect(meals()[2]).toMatchObject({ id: last, items: [{ id: 'c', amount: 50 }] });
  });
});
