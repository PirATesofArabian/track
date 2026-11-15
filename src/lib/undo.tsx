import { useEffect, useSyncExternalStore } from 'react'
import type { Table } from 'dexie'

type Item = { id: number; label: string; restore: () => Promise<unknown> | void }

let items: Item[] = []
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
const snapshot = () => items

/** Register something that can be undone. `restore` puts the data back. */
export function offerUndo(label: string, restore: Item['restore']) {
  items = [...items, { id: ++seq, label, restore }].slice(-10)
  emit()
}

/** Delete a row, but keep a copy so the Undo button can put it back with the same id. */
export async function deleteWithUndo<T, K>(table: Table<T, K>, key: K, label: string) {
  const row = await table.get(key)
  if (!row) return
  await table.delete(key)
  offerUndo(label, () => table.put(row))
}

export function UndoHost() {
  const list = useSyncExternalStore(subscribe, snapshot)
  const last = list[list.length - 1]
  useEffect(() => {
    if (!last) return
    const t = setTimeout(() => { items = []; emit() }, 8000)
    return () => clearTimeout(t)
  }, [last?.id])
  if (!last) return null
  return (
    <div className="fixed bottom-24 inset-x-0 z-[70] flex justify-center px-4">
      <div className="flex items-center gap-3 pl-4 pr-2 h-11 rounded-full bg-zinc-100 text-black text-sm shadow-lg">
        <span>{last.label}</span>
        <button className="h-8 px-3 rounded-full bg-black text-lime-400 font-semibold"
          onClick={async () => { items = items.filter((i) => i.id !== last.id); emit(); await last.restore() }}>Undo</button>
      </div>
    </div>
  )
}
