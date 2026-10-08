// AST of the greenhouse script language: a small, deterministic subset of JavaScript.
// Every node carries its 1-based source position for error messages.

export interface Pos {
  line: number;
  col: number;
}

export type BinaryOp = "+" | "-" | "*" | "/" | "%" | "**" | "==" | "!=" | "===" | "!==" | "<" | ">" | "<=" | ">=" | "in";
export type LogicalOp = "&&" | "||" | "??";
export type AssignOp = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "**=" | "&&=" | "||=" | "??=";

export interface Literal extends Pos {
  type: "Literal";
  value: number | string | boolean | null | undefined;
  /** An array hole (`[a, , b]`). */
  hole?: boolean;
}
export interface Template extends Pos {
  type: "Template";
  quasis: string[];
  exprs: Expr[];
}
export interface Ident extends Pos {
  type: "Ident";
  name: string;
}
export interface Spread extends Pos {
  type: "Spread";
  arg: Expr;
}
export interface ArrayLit extends Pos {
  type: "Array";
  elements: (Expr | Spread)[];
}
export interface Prop extends Pos {
  type: "Prop";
  /** A plain key, or an expression for `[computed]` keys. */
  key: string | Expr;
  computed: boolean;
  value: Expr;
  shorthand: boolean;
}
export interface ObjectLit extends Pos {
  type: "Object";
  props: (Prop | Spread)[];
}
export interface Func extends Pos {
  type: "Func";
  /** Parse-order index within its program: identifies a top-level function value kept between cycles. */
  id: number;
  name: string | null;
  params: Pattern[];
  rest: Pattern | null;
  /** A block for `function` and `=> {}`; an expression for `=> expr`. */
  body: Stmt[] | Expr;
  arrow: boolean;
}
export interface Unary extends Pos {
  type: "Unary";
  op: "!" | "-" | "+" | "typeof" | "delete";
  arg: Expr;
}
export interface Update extends Pos {
  type: "Update";
  op: "++" | "--";
  prefix: boolean;
  target: Ident | Member;
}
export interface Binary extends Pos {
  type: "Binary";
  op: BinaryOp;
  left: Expr;
  right: Expr;
}
export interface Logical extends Pos {
  type: "Logical";
  op: LogicalOp;
  left: Expr;
  right: Expr;
}
export interface Cond extends Pos {
  type: "Cond";
  test: Expr;
  cons: Expr;
  alt: Expr;
}
export interface Assign extends Pos {
  type: "Assign";
  op: AssignOp;
  target: Pattern;
  value: Expr;
}
export interface Member extends Pos {
  type: "Member";
  object: Expr;
  /** Plain name for `a.b`; an expression for `a[b]`. */
  prop: string | Expr;
  computed: boolean;
  optional: boolean;
}
export interface Call extends Pos {
  type: "Call";
  callee: Expr;
  args: (Expr | Spread)[];
  optional: boolean;
}
/** Wraps a member/call chain that contains `?.`, so a short-circuit ends the whole chain. */
export interface Chain extends Pos {
  type: "Chain";
  expr: Expr;
}

export type Expr = Literal | Template | Ident | ArrayLit | ObjectLit | Func | Unary | Update | Binary | Logical | Cond | Assign | Member | Call | Chain;

export interface ArrayPattern extends Pos {
  type: "ArrayPattern";
  elements: (Pattern | null)[];
  rest: Pattern | null;
}
export interface ObjectPattern extends Pos {
  type: "ObjectPattern";
  props: { key: string | Expr; computed: boolean; value: Pattern }[];
  rest: Ident | null;
}
export interface DefaultPattern extends Pos {
  type: "DefaultPattern";
  target: Pattern;
  value: Expr;
}
/** Member targets only appear in assignments, never in declarations. */
export type Pattern = Ident | Member | ArrayPattern | ObjectPattern | DefaultPattern;

export type DeclKind = "let" | "const" | "var";

export interface VarDecl extends Pos {
  type: "VarDecl";
  kind: DeclKind;
  decls: { target: Pattern; init: Expr | null }[];
}
export interface FuncDecl extends Pos {
  type: "FuncDecl";
  name: string;
  func: Func;
}
export interface Return extends Pos {
  type: "Return";
  arg: Expr | null;
}
export interface If extends Pos {
  type: "If";
  test: Expr;
  cons: Stmt;
  alt: Stmt | null;
}
export interface While extends Pos {
  type: "While";
  test: Expr;
  body: Stmt;
}
export interface DoWhile extends Pos {
  type: "DoWhile";
  body: Stmt;
  test: Expr;
}
export interface For extends Pos {
  type: "For";
  init: VarDecl | Expr | null;
  test: Expr | null;
  update: Expr | null;
  body: Stmt;
}
export interface ForEach extends Pos {
  type: "ForEach";
  /** null: assigns to an existing variable (`for (x of xs)`). */
  kind: DeclKind | null;
  target: Pattern;
  /** `of` walks values, `in` walks keys. */
  of: boolean;
  iter: Expr;
  body: Stmt;
}
export interface Jump extends Pos {
  type: "Break" | "Continue";
}
export interface Block extends Pos {
  type: "Block";
  body: Stmt[];
}
export interface ExprStmt extends Pos {
  type: "Expr";
  expr: Expr;
}
export interface Switch extends Pos {
  type: "Switch";
  disc: Expr;
  cases: { test: Expr | null; body: Stmt[] }[];
}
export interface Throw extends Pos {
  type: "Throw";
  arg: Expr;
}
export interface Try extends Pos {
  type: "Try";
  block: Stmt[];
  param: Pattern | null;
  handler: Stmt[] | null;
  finalizer: Stmt[] | null;
}
export interface Empty extends Pos {
  type: "Empty";
}

export type Stmt = VarDecl | FuncDecl | Return | If | While | DoWhile | For | ForEach | Jump | Block | ExprStmt | Switch | Throw | Try | Empty;

export type Node = Expr | Stmt | Pattern | Spread | Prop;
