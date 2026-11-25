import * as THREE from 'three';
import { DESK_SIZE } from '../../../shared/layout';
import type { HandoffKind } from '../../../shared/protocol';
import { textSprite, disposeSprite } from '../../world/toon';
import type { DeskView } from '../../world/types';
import { STACK_SHOWN, STACK_STEP, folderModel, trayModel } from './folder';

// The in-trays: on the desk of each visitor sitting on a floor that keeps tickets, a tray at the
// front corner opposite the one it dances on, with a folder for each open ticket waiting on its role
// (a few, then a count over the tray of how many in all).

/** Where the tray stands on a desk, in the desk's own frame (the chair on its +z side). */
const AT = new THREE.Vector3(-0.72, DESK_SIZE.height, 0.2);

interface InTray {
  desk: DeskView;
  tray: THREE.Group;
  key: string;
  count: THREE.Sprite | null;
}

export class Trays {
  private byVisitor = new Map<string, InTray>();

  /** The trays as they're to be now: `seated` visitors at their desks, each with the folders `folders` gives it (empty: an empty tray). */
  sync(seated: readonly [string, DeskView][], folders: (visitor: string) => readonly HandoffKind[]) {
    const here = new Set(seated.map(([id]) => id));
    for (const id of [...this.byVisitor.keys()]) if (!here.has(id)) this.remove(id);
    for (const [id, desk] of seated) {
      let t = this.byVisitor.get(id);
      if (t && t.desk !== desk) {
        this.remove(id);
        t = undefined;
      }
      if (!t) {
        const tray = trayModel();
        tray.position.copy(AT);
        tray.rotation.y = 0.15;
        desk.group.add(tray);
        t = { desk, tray, key: '', count: null };
        this.byVisitor.set(id, t);
      }
      const kinds = folders(id);
      const key = kinds.join(',');
      if (key === t.key) continue;
      t.key = key;
      this.fill(t, kinds);
    }
  }

  private fill(t: InTray, kinds: readonly HandoffKind[]) {
    for (const c of [...t.tray.children]) if (c.userData.folder) t.tray.remove(c);
    kinds.slice(0, STACK_SHOWN).forEach((kind, i) => {
      const f = folderModel(kind);
      f.userData.folder = true;
      f.position.set(0, 0.016 + i * STACK_STEP, 0.01);
      f.rotation.y = ((i * 41) % 7) * 0.025 - 0.07;
      t.tray.add(f);
    });
    if (t.count) {
      t.tray.remove(t.count);
      disposeSprite(t.count);
      t.count = null;
    }
    if (kinds.length > 1) {
      t.count = textSprite(`📂 ${kinds.length}`, { size: 26, bg: '#fffaf3' });
      t.count.scale.multiplyScalar(0.55);
      t.count.position.set(0, 0.32, 0);
      t.tray.add(t.count);
    }
  }

  /** Where a folder lands in a visitor's tray, in the world: on top of its stack. */
  top(visitor: string): THREE.Vector3 | null {
    const t = this.byVisitor.get(visitor);
    if (!t) return null;
    const n = Math.min(STACK_SHOWN, t.key ? t.key.split(',').length : 0);
    t.desk.group.updateMatrixWorld(true);
    return t.tray.localToWorld(new THREE.Vector3(0, 0.03 + n * STACK_STEP, 0));
  }

  private remove(id: string) {
    const t = this.byVisitor.get(id);
    if (!t) return;
    t.tray.removeFromParent();
    if (t.count) disposeSprite(t.count);
    this.byVisitor.delete(id);
  }

  clear() {
    for (const id of [...this.byVisitor.keys()]) this.remove(id);
  }
}
