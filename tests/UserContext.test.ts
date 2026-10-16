import { jest } from '@jest/globals';
import { UserContext } from '../src/context/UserContext.js';
import { MemoryContextStore } from '../src/context/MemoryContextStore.js';
import type { ContextStore } from '../src/context/ContextStore.js';
import { ContextConflictError } from '../src/context/ContextStore.js';

describe('UserContext (session semantics)', () => {
  let store: MemoryContextStore;

  beforeEach(() => {
    store = new MemoryContextStore();
  });

  it('loads an empty context for an unknown user', async () => {
    const ctx = await UserContext.load(store, '111');
    expect(ctx.userId).toBe('111');
    expect(ctx.isEmpty).toBe(true);
    expect(ctx.isDirty).toBe(false);
    expect(ctx.version).toBe(0);
    expect(ctx.exists).toBe(false);
    expect(ctx.get('step')).toBeUndefined();
    expect(ctx.get('step', 0)).toBe(0);
  });

  it('get/set/has/delete/keys/all operate on the in-memory copy', async () => {
    const ctx = await UserContext.load(store, '111');
    ctx.set('step', 1).set('name', 'Ada');
    expect(ctx.get('step')).toBe(1);
    expect(ctx.has('name')).toBe(true);
    expect(ctx.keys().sort()).toEqual(['name', 'step']);
    expect(ctx.all()).toEqual({ step: 1, name: 'Ada' });
    expect(ctx.size).toBe(2);
    expect(ctx.delete('name')).toBe(true);
    expect(ctx.delete('name')).toBe(false);
    expect(ctx.has('name')).toBe(false);
    // Nothing persisted yet
    expect(await store.get('111')).toBeUndefined();
  });

  it('set(key, undefined) removes the key', async () => {
    const ctx = await UserContext.load(store, '111');
    ctx.set('a', 1);
    ctx.set('a', undefined);
    expect(ctx.has('a')).toBe(false);
  });

  it('assign() merges multiple keys', async () => {
    const ctx = await UserContext.load(store, '111');
    ctx.set('a', 1);
    ctx.assign({ b: 2, c: 3 });
    expect(ctx.all()).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('save() persists changes and subsequent loads see them', async () => {
    const ctx = await UserContext.load(store, '111');
    ctx.set('step', 2);
    expect(ctx.isDirty).toBe(true);
    await ctx.save();
    expect(ctx.isDirty).toBe(false);
    expect(ctx.version).toBe(1);
    expect(ctx.exists).toBe(true);

    const again = await UserContext.load(store, '111');
    expect(again.get('step')).toBe(2);
    expect(again.version).toBe(1);
  });

  it('bumps the version on every persisted change', async () => {
    const ctx = await UserContext.load(store, '111');
    ctx.set('a', 1);
    await ctx.save();
    ctx.set('a', 2);
    await ctx.save();
    expect(ctx.version).toBe(2);
    expect((await store.get('111'))?.version).toBe(2);
  });

  it('detects nested mutations of values returned by get()', async () => {
    await store.set('111', { items: ['x'] }, 0);
    const ctx = await UserContext.load(store, '111');
    ctx.get<string[]>('items')!.push('y');
    expect(ctx.isDirty).toBe(true);
    await ctx.save();
    expect((await store.get('111'))?.data).toEqual({ items: ['x', 'y'] });
  });

  it('detects direct mutation through userData', async () => {
    const ctx = await UserContext.load(store, '111');
    ctx.userData.flag = true;
    expect(ctx.isDirty).toBe(true);
    await ctx.save();
    expect((await store.get('111'))?.data).toEqual({ flag: true });
  });

  it('does not write when nothing changed', async () => {
    const setSpy = jest.spyOn(store, 'set');
    const ctx = await UserContext.load(store, '111');
    ctx.get('anything');
    await ctx.save();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('touches (refreshes TTL) instead of writing when an existing record is unchanged', async () => {
    await store.set('111', { a: 1 }, 0);
    const setSpy = jest.spyOn(store, 'set');
    const touchSpy = jest.spyOn(store, 'touch');

    const ctx = await UserContext.load(store, '111');
    await ctx.save();

    expect(setSpy).not.toHaveBeenCalled();
    expect(touchSpy).toHaveBeenCalledWith('111');
  });

  it('does not touch when the record never existed', async () => {
    const touchSpy = jest.spyOn(store, 'touch');
    const ctx = await UserContext.load(store, '111');
    await ctx.save();
    expect(touchSpy).not.toHaveBeenCalled();
  });

  it('clear() + save() deletes the stored record (version-checked)', async () => {
    await store.set('111', { a: 1 }, 0);
    const deleteSpy = jest.spyOn(store, 'delete');

    const ctx = await UserContext.load(store, '111');
    ctx.clear();
    await ctx.save();

    expect(deleteSpy).toHaveBeenCalledWith('111', 1);
    expect(store.size).toBe(0);
    expect(ctx.version).toBe(0);
    expect(ctx.exists).toBe(false);
  });

  it('destroy() deletes immediately (unconditionally) and resets state', async () => {
    await store.set('111', { a: 1 }, 0);
    const deleteSpy = jest.spyOn(store, 'delete');
    const ctx = await UserContext.load(store, '111');
    await ctx.destroy();
    expect(deleteSpy).toHaveBeenCalledWith('111');
    expect(ctx.isEmpty).toBe(true);
    expect(ctx.isDirty).toBe(false);
    expect(ctx.version).toBe(0);
    expect(await store.get('111')).toBeUndefined();
  });

  it('reload() discards unsaved changes', async () => {
    await store.set('111', { a: 1 }, 0);
    const ctx = await UserContext.load(store, '111');
    ctx.set('a', 99);
    await ctx.reload();
    expect(ctx.get('a')).toBe(1);
    expect(ctx.isDirty).toBe(false);
  });

  it('is detached from the object the store hands back', async () => {
    const backing = { list: [1] };
    const custom: ContextStore = {
      get: async () => ({ data: backing, version: 1 }),
      set: async () => true,
      delete: async () => true,
    };
    const ctx = await UserContext.load(custom, '111');
    ctx.get<number[]>('list')!.push(2);
    expect(backing.list).toEqual([1]);
  });

  describe('optimistic locking', () => {
    it('throws ContextConflictError when the record changed since it was loaded', async () => {
      const mine = await UserContext.load(store, '111');
      const theirs = await UserContext.load(store, '111');

      theirs.set('winner', 'them');
      await theirs.save();

      mine.set('winner', 'me');
      await expect(mine.save()).rejects.toThrow(ContextConflictError);
      // Nothing of mine was written; version untouched
      expect((await store.get('111'))?.data).toEqual({ winner: 'them' });
      expect(mine.version).toBe(0);
    });

    it('throws when the record was created concurrently (insert race)', async () => {
      const a = await UserContext.load(store, '111');
      const b = await UserContext.load(store, '111');
      a.set('x', 1);
      await a.save();
      b.set('x', 2);
      await expect(b.save()).rejects.toThrow(ContextConflictError);
    });

    it('throws when the record was deleted concurrently', async () => {
      await store.set('111', { a: 1 }, 0);
      const mine = await UserContext.load(store, '111');
      await store.delete('111');
      mine.set('a', 2);
      await expect(mine.save()).rejects.toThrow(ContextConflictError);
    });

    it('throws when clearing a record that changed concurrently', async () => {
      await store.set('111', { a: 1 }, 0);
      const mine = await UserContext.load(store, '111');
      await store.set('111', { a: 2 }, 1);
      mine.clear();
      await expect(mine.save()).rejects.toThrow(ContextConflictError);
      expect((await store.get('111'))?.data).toEqual({ a: 2 });
    });

    it('clearing a record that was deleted concurrently is a conflict too', async () => {
      await store.set('111', { a: 1 }, 0);
      const mine = await UserContext.load(store, '111');
      await store.delete('111');
      mine.clear();
      await expect(mine.save()).rejects.toThrow(ContextConflictError);
    });

    it('carries the user id and expected version on the error', async () => {
      await store.set('111', { a: 1 }, 0);
      const mine = await UserContext.load(store, '111');
      await store.set('111', { a: 2 }, 1);
      mine.set('a', 3);
      const error = await mine.save().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ContextConflictError);
      expect((error as ContextConflictError).userId).toBe('111');
      expect((error as ContextConflictError).expectedVersion).toBe(1);
    });

    it('recovers after reload()', async () => {
      await store.set('111', { a: 1 }, 0);
      const mine = await UserContext.load(store, '111');
      await store.set('111', { a: 2 }, 1);
      mine.set('b', 1);
      await expect(mine.save()).rejects.toThrow(ContextConflictError);
      await mine.reload();
      expect(mine.all()).toEqual({ a: 2 });
      mine.set('b', 1);
      await mine.save();
      expect(await store.get('111')).toEqual({
        data: { a: 2, b: 1 },
        version: 3,
      });
    });
  });

  it('toJSON() exposes the data for serialisation', async () => {
    const ctx = await UserContext.load(store, '111');
    ctx.set('a', 1);
    expect(JSON.parse(JSON.stringify(ctx))).toEqual({ a: 1 });
  });
});
