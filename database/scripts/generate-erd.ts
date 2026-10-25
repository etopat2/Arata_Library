import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { instance } from "@viz-js/viz";
import dotenv from "dotenv";
import pg from "pg";

type Column = { schema_name: string; table_name: string; column_name: string; data_type: string; nullable: boolean; attnum: number; primary_key: boolean };
type ForeignKey = { name: string; child_schema: string; child_table: string; parent_schema: string; parent_table: string; child_columns: string[]; parent_columns: string[]; child_attnums: number[] };
type UniqueKey = { schema_name: string; table_name: string; key_attnums: number[] };

const env = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE || ".env.local", "utf8"));
const url = process.env.MIGRATION_DATABASE_URL || env.MIGRATION_DATABASE_URL;
if (!url || new URL(url).pathname !== "/arata_techlibrary_dev") throw new Error("ERD generation requires the migrated Arata development database");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
const escapeDot = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
const entityId = (schema: string, table: string) => `${schema}_${table}`;

try {
  await client.connect();
  const columns = (await client.query<Column>(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS data_type, NOT a.attnotnull AS nullable,
      a.attnum, EXISTS (
        SELECT 1 FROM pg_constraint pk WHERE pk.conrelid = c.oid AND pk.contype = 'p' AND a.attnum = ANY(pk.conkey)
      ) AS primary_key
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'r' AND n.nspname IN ('app', 'research', 'research_private')
    ORDER BY n.nspname, c.relname, a.attnum`)).rows;
  const foreignKeys = (await client.query<ForeignKey>(`
    SELECT fk.conname AS name, cn.nspname AS child_schema, child.relname AS child_table,
      pn.nspname AS parent_schema, parent.relname AS parent_table,
      ARRAY(SELECT a.attname FROM unnest(fk.conkey) WITH ORDINALITY AS k(num, ord)
        JOIN pg_attribute a ON a.attrelid = child.oid AND a.attnum = k.num ORDER BY k.ord)::text[] AS child_columns,
      ARRAY(SELECT a.attname FROM unnest(fk.confkey) WITH ORDINALITY AS k(num, ord)
        JOIN pg_attribute a ON a.attrelid = parent.oid AND a.attnum = k.num ORDER BY k.ord)::text[] AS parent_columns,
      fk.conkey::int[] AS child_attnums
    FROM pg_constraint fk JOIN pg_class child ON child.oid = fk.conrelid
      JOIN pg_namespace cn ON cn.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = fk.confrelid
      JOIN pg_namespace pn ON pn.oid = parent.relnamespace
    WHERE fk.contype = 'f' AND cn.nspname IN ('app', 'research', 'research_private')
    ORDER BY cn.nspname, child.relname, fk.conname`)).rows;
  const uniqueKeys = (await client.query<UniqueKey>(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, k.conkey::int[] AS key_attnums
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE k.contype IN ('p', 'u') AND n.nspname IN ('app', 'research', 'research_private')`)).rows;
  const tableNames = [...new Set(columns.map(c => `${c.schema_name}.${c.table_name}`))];
  if (tableNames.length !== 87 || foreignKeys.length !== 150) throw new Error("Physical schema differs from the verified 87-table, 150-FK baseline");
  const byTable = new Map(tableNames.map(name => [name, columns.filter(c => `${c.schema_name}.${c.table_name}` === name)]));
  const relationColumns = new Set(foreignKeys.flatMap(fk => fk.child_columns.map(column => `${fk.child_schema}.${fk.child_table}.${column}`)));
  const unique = (fk: ForeignKey) => uniqueKeys.some(key => key.schema_name === fk.child_schema && key.table_name === fk.child_table
    && key.key_attnums.length === fk.child_attnums.length && key.key_attnums.every(n => fk.child_attnums.includes(n)));

  const mermaid: string[] = ["erDiagram"];
  for (const table of tableNames) {
    const cols = byTable.get(table)!;
    mermaid.push(`  ${entityId(cols[0]!.schema_name, cols[0]!.table_name)} {`);
    for (const col of cols) {
      const type = col.data_type.replace(/[^A-Za-z0-9_]/g, "_");
      const flags = [col.primary_key ? "PK" : "", relationColumns.has(`${table}.${col.column_name}`) ? "FK" : ""].filter(Boolean).join(",");
      mermaid.push(`    ${type} ${col.column_name}${flags ? ` ${flags}` : ""}`);
    }
    mermaid.push("  }");
  }
  for (const fk of foreignKeys) {
    const optional = fk.child_columns.some(name => byTable.get(`${fk.child_schema}.${fk.child_table}`)!.find(c => c.column_name === name)?.nullable);
    const cardinality = unique(fk) ? (optional ? "o|--o|" : "||--o|") : (optional ? "o|--o{" : "||--o{");
    mermaid.push(`  ${entityId(fk.parent_schema, fk.parent_table)} ${cardinality} ${entityId(fk.child_schema, fk.child_table)} : "${fk.name}"`);
  }

  const dot: string[] = [
    "digraph ArataPhysicalERD {", "  graph [rankdir=LR, bgcolor=\"white\", fontname=\"Arial\", overlap=false, splines=true, nodesep=0.25, ranksep=1.0];",
    "  node [shape=box, style=\"rounded,filled\", fontname=\"Arial\", fontsize=9, color=\"#40516b\", fillcolor=\"#f7f9fc\"];",
    "  edge [fontname=\"Arial\", fontsize=7, color=\"#70839b\", arrowsize=0.5];",
  ];
  for (const table of tableNames) {
    const cols = byTable.get(table)!;
    const node = entityId(cols[0]!.schema_name, cols[0]!.table_name);
    const fill = cols[0]!.schema_name === "research_private" ? "#fff0e8" : cols[0]!.schema_name === "research" ? "#e8f5ef" : "#f7f9fc";
    const label = `${table}\n${cols.map(c => `${c.primary_key ? "PK " : relationColumns.has(`${table}.${c.column_name}`) ? "FK " : ""}${c.column_name}${c.nullable ? "?" : ""}`).join("\n")}`;
    dot.push(`  "${node}" [label="${escapeDot(label)}", fillcolor="${fill}"];`);
  }
  for (const fk of foreignKeys) {
    const optional = fk.child_columns.some(name => byTable.get(`${fk.child_schema}.${fk.child_table}`)!.find(c => c.column_name === name)?.nullable);
    const label = `${fk.name} (${fk.child_columns.join(", ")})\n${optional ? "0..1" : "1"} : ${unique(fk) ? "0..1" : "0..many"}`;
    dot.push(`  "${entityId(fk.parent_schema, fk.parent_table)}" -> "${entityId(fk.child_schema, fk.child_table)}" [label="${escapeDot(label)}"];`);
  }
  dot.push("}");
  const directory = resolve("database/erd");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "arata-physical.mmd"), `${mermaid.join("\n")}\n`);
  writeFileSync(resolve(directory, "arata-physical.dot"), `${dot.join("\n")}\n`);
  const viz = await instance();
  writeFileSync(resolve(directory, "arata-physical.svg"), viz.renderString(dot.join("\n"), { format: "svg", engine: "dot" }));
  console.log(`Generated physical ERD: ${tableNames.length} tables and ${foreignKeys.length} named relationships (Mermaid, DOT, SVG).`);
} finally {
  await client.end().catch(() => undefined);
}
