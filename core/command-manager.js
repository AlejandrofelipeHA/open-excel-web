export class CommandManager {
  undoStack = [];
  redoStack = [];
  constructor(onChange, limit = 100) {
    this.onChange = onChange;
    this.limit = limit;
  }
  run(command) {
    command.execute();
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange();
  }
  transfer(source, destination, method) {
    const command = source.at(-1);
    if (!command) return;
    command[method]();
    source.pop();
    destination.push(command);
    this.onChange();
  }
  undo() { this.transfer(this.undoStack, this.redoStack, 'undo'); }
  redo() { this.transfer(this.redoStack, this.undoStack, 'execute'); }
}

export class CellCommand {
  constructor(book, engine, sheet, updates) {
    this.book = book;
    this.engine = engine;
    this.sheet = sheet;
    this.after = updates;
    this.before = new Map([...updates.keys()].map(a => [a,book.get(sheet).cells.get(a)]));
  }
  apply(patch) {
    const changed = [];
    for (const [a,cell] of patch) {
      const previous = this.book.get(this.sheet).cells.get(a);
      this.book.set(this.sheet,a,cell);
      if ((previous?.raw ?? '') !== (cell?.raw ?? '') || previous?.cached !== cell?.cached || previous?.error !== cell?.error) changed.push(a);
    }
    this.engine.update(this.sheet,changed);
  }
  execute() { this.apply(this.after); }
  undo() { this.apply(this.before); }
}
