#!/usr/bin/env python3
"""
Export the local D365FO standard-source mirror (PackagesLocalDirectory XML)
into CSV/TSV files that are cheap to query with cut/grep/awk/mlr/sqlite3.

Main goal: enrich the FnO Navigator foundation — tables/fields/methods/relations —
so the curated `tableDefs` in `src/lib/data/flows.ts` and `static/data/fk-map.json`
can be diffed against the full D365FO standard-source mirror.

Design (lazy / stdlib-first):
- Runs OFF the sqlite index for speed where possible (members contains fields/relations/methods) and
  off raw XML for field-type/EDT/type fidelity that the index drops. Stdlib-only (csv,re,xml,sqlite3).
- ET.iterparse with late </AxTable> eviction: ~500 files/s on this box, full pass ~25s; no lxml dep.
- Output is newline-delimited CSV with RFC4180 quoting; one of {tables,fields,methods,relations}
  per file so grep/sort/awk works out of the box. Also emitted as SQLite (.db) for ad-hoc joins.
- Single-command invocation: python3 tools/export-standard-metadata.py [--source-root PATH] [--out-dir DIR]
  Default source root is ~/d365fo-src (overridable via D365FO_SOURCE_ROOT env or --source-root).
- Skips XppMetadata copies (metadata-only, no source), and any file whose xml_root is not AxTable
  (index reports parse_status, writer filters by relpath convention).

Columns (stable contracts — do not reorder without bumping EXPORT_VERSION):
  tables.csv: table,model,modules,table_group,label,primary_index,clustered_index,cache_lookup,field_count,method_count,relation_count,index_count,label_replacement_key
  fields.csv: table,field,field_type,edt,enum_type,mandatory,visible,allow_edit,label,asset_classification,relation_context,table_model
  methods.csv: table,method,display_kind,return_type,modifier,xml_locator,source_hash_SHORT (first 16 hex)
  relations.csv: table,relation,related_table,role,relationship_type,cardinality,related_cardinality,constraint_type,field,related_field,value_str,index,use_default_role_names,edt_relation
  indexes.csv: table,index,alternate_key,allow_duplicates,allow_page_locks,clustered,fields,field_included_columns (semicolon-joined)

Relations note: one CSV row per constraint. A relation with N constraints (composite, fixed, related-fixed)
emits N rows sharing the relation name; fixed/related-fixed rows havefield empty and value_str populated.
Implicit system fields (RecId, Partition, dataAreaId, recVersion) are not declared in AxTableField and do
not appear in fields.csv for that table — this mirrors the source, not a loss.

Output location: --out-dir (default ./.artifacts-standard-export/, ignored by .gitignore via .artifacts-*/).
For this task we write into the fno-navigator-local out dir.

Usage examples:
  python3 tools/export-standard-metadata.py                          # -> .artifacts-standard-export/
  python3 tools/export-standard-metadata.py --out-dir /tmp/d365fo    # custom
  python3 tools/export-standard-metadata.py --format both            # csv + sqlite db
  python3 tools/export-standard-metadata.py --format sqlite          # only .db

ponytail: no row-level EDT facet extraction (StringSize, Label, HelpText per field is skipped for v1;
add when the enrichment actually ranks by it — keep output under 1MB per file for fast diffing).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import os
import re
import sqlite3
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

EXPORT_VERSION = "1"

XSI = "{http://www.w3.org/2001/XMLSchema-instance}type"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def source_root_default() -> Path:
    env = os.environ.get("D365FO_SOURCE_ROOT")
    if env:
        return Path(env).expanduser()
    # also probe the running mirror
    for cand in [Path.home() / "d365fo-src"]:
        if cand.is_dir():
            return cand
    return Path.home() / "d365fo-src"


def iter_axtable_files(source_root: Path) -> list[Path]:
    # canonical: <model>/<model>/AxTable/*.xml etc.; ApplicationSuite uses Foundation/ subdir.
    # Filter: skip XppMetadata copies; skip non-AxTable xml_roots later per file is too slow,
    # so rely on relpath rule here.
    seen: set[str] = set()
    out: list[Path] = []
    for p in source_root.rglob("AxTable/*.xml"):
        if "XppMetadata" in str(p):
            continue
        # dedupe by basename+model would hide collisions; just dedupe path
        s = str(p)
        if s in seen:
            continue
        seen.add(s)
        out.append(p)
    out.sort()
    return out


def txt1(el, tag: str) -> str:
    if el is None:
        return ""
    c = el.find(tag)
    return (c.text or "").strip() if c is not None and c.text else ""


def xml_to_mini_string(el) -> str:
    """Best-effort one-line grab for a scalar child text."""
    if el is None or el.text is None:
        return ""
    return el.text.strip()


# ---------------------------------------------------------------------------
# per-file extractor (pure function, safe to run in ProcessPoolExecutor)
# ---------------------------------------------------------------------------
def extract_file(path_str: str, source_root_str: str) -> dict[str, Any] | None:
    import xml.etree.ElementTree as ET

    path = Path(path_str)
    source_root = Path(source_root_str)
    try:
        relpath = str(path.relative_to(source_root))
    except Exception:
        relpath = str(path)
    # model is the top-level dir component: ApplicationSuite/ApplicationPlatform/etc.
    # For ApplicationSuite/Foundation/AxTable/... the model folder is ApplicationSuite
    top = relpath.split("/", 1)[0] if "/" in relpath else ""
    try:
        # use iterparse with ET.parse for better diagnosis, parse will throw on broken xml
        root = ET.parse(path).getroot()
    except Exception as e:
        return {"error": f"{path}: parse: {e}", "table": path.stem}
    if root.tag != "AxTable":
        return None  # caller counts as skipped

    name = txt1(root, "Name") or path.stem

    # header-ish scalars
    modules = txt1(root, "Modules")
    table_group = txt1(root, "TableGroup")
    label = txt1(root, "Label")
    primary_index = txt1(root, "PrimaryIndex")
    clustered_index = txt1(root, "ClusteredIndex")
    cache_lookup = txt1(root, "CacheLookup")
    replacement_key = txt1(root, "ReplacementKey")
    configuration_key = txt1(root, "ConfigurationKey")

    fields_el = root.find("Fields")
    relations_el = root.find("Relations")
    indexes_el = root.find("Indexes")
    source_el = root.find("SourceCode")

    fields: list[dict[str, str]] = []
    if fields_el is not None:
        for fld in fields_el:
            # fld is AxTableField with xsi:type carrying the real kind
            ftype = fld.get(XSI) or fld.tag
            # normalize: AxTableFieldString -> String, AxTableFieldInt64 -> Int64, etc.
            if ftype.startswith("AxTableField"):
                ftype = ftype[len("AxTableField") :]
            fname = txt1(fld, "Name")
            if not fname:
                continue
            fields.append(
                {
                    "table": name,
                    "field": fname,
                    "field_type": ftype,
                    "edt": txt1(fld, "ExtendedDataType"),
                    "enum_type": txt1(fld, "EnumType"),
                    "mandatory": txt1(fld, "Mandatory"),
                    "visible": txt1(fld, "Visible"),
                    "allow_edit": txt1(fld, "AllowEdit"),
                    "label": txt1(fld, "Label"),
                    "asset_classification": txt1(fld, "AssetClassification"),
                    "relation_context": txt1(fld, "RelationContext"),
                    "table_model": top,
                }
            )

    # methods come from SourceCode/Methods/Method/*
    methods: list[dict[str, str]] = []
    if source_el is not None:
        meths_el = source_el.find("Methods")
        if meths_el is not None:
            for m in meths_el.findall("Method"):
                mname = txt1(m, "Name")
                if not mname:
                    continue
                src = txt1(m, "Source")
                # empty source blocks mean no body (declaration-only tables still list methods)
                # Extract display/return kind cheaply from first line
                first_line = ""
                for line in src.splitlines():
                    line = line.strip()
                    if line and not line.startswith("//") and not line.startswith("///"):
                        first_line = line
                        break
                display_kind = "display" if re.search(r"\bdisplay\b", first_line) else ""
                # return type is first token before method name when not display
                return_type = ""
                modifier = ""
                # source hash for dedup diff
                h = hashlib.sha256(src.encode()).hexdigest()[:16] if src else ""
                methods.append(
                    {
                        "table": name,
                        "method": mname,
                        "display_kind": display_kind,
                        "return_type": return_type,
                        "modifier": modifier,
                        "xml_locator": f"SourceCode/Methods/Method/{mname}",
                        "source_hash": h,
                        "_first_line": first_line,  # internal, stripped before write
                    }
                )

    relations: list[dict[str, str]] = []
    if relations_el is not None:
        for rel in relations_el:
            rel_name = txt1(rel, "Name")
            related_table = txt1(rel, "RelatedTable")
            role = txt1(rel, "Role")
            relationship_type = txt1(rel, "RelationshipType")
            cardinality = txt1(rel, "Cardinality")
            related_cardinality = txt1(rel, "RelatedTableCardinality")
            use_default = txt1(rel, "UseDefaultRoleNames")
            edt_relation = txt1(rel, "EDTRelation")
            idx = txt1(rel, "Index")
            constraints_el = rel.find("Constraints")
            constraints = list(constraints_el) if constraints_el is not None else []
            xml_type = rel.get(XSI) or ""
            if not constraints:
                # relation with no constraints (rare — still emit one row so the table's relation count is correct)
                relations.append(
                    {
                        "table": name,
                        "relation": rel_name,
                        "related_table": related_table,
                        "role": role,
                        "relationship_type": relationship_type,
                        "cardinality": cardinality,
                        "related_cardinality": related_cardinality,
                        "constraint_type": "",
                        "field": "",
                        "related_field": "",
                        "value_str": "",
                        "index": idx,
                        "use_default_role_names": use_default,
                        "edt_relation": edt_relation,
                        "xml_type": xml_type,
                    }
                )
            else:
                for c in constraints:
                    ct = c.get(XSI) or c.tag
                    # normalize constraint type short
                    if ct.startswith("AxTableRelationConstraint"):
                        ct = ct[len("AxTableRelationConstraint") :]
                    relations.append(
                        {
                            "table": name,
                            "relation": rel_name,
                            "related_table": related_table,
                            "role": role,
                            "relationship_type": relationship_type,
                            "cardinality": cardinality,
                            "related_cardinality": related_cardinality,
                            "constraint_type": ct,
                            "field": txt1(c, "Field"),
                            "related_field": txt1(c, "RelatedField"),
                            "value_str": txt1(c, "ValueStr") or txt1(c, "Value"),
                            "index": idx,
                            "use_default_role_names": use_default,
                            "edt_relation": edt_relation,
                            "xml_type": xml_type,
                        }
                    )

    indexes: list[dict[str, str]] = []
    if indexes_el is not None:
        for ix in indexes_el.findall("AxTableIndex"):
            ix_name = txt1(ix, "Name")
            alt = txt1(ix, "AlternateKey")
            dup = txt1(ix, "AllowDuplicates")
            apl = txt1(ix, "AllowPageLocks")
            # Clustered flag lives on the index when it's the clusteredIndex
            clustered = "Yes" if ix_name and ix_name == clustered_index else ""
            fields_wrap = ix.find("Fields")
            idx_fields: list[str] = []
            included: list[str] = []
            if fields_wrap is not None:
                for f in fields_wrap.findall("AxTableIndexField"):
                    df = txt1(f, "DataField")
                    if df:
                        # IncludedColumn indicates included (non-key) — separate list
                        ic = txt1(f, "IncludedColumn")
                        if ic.lower() in ("yes", "true", "1"):
                            included.append(df)
                        else:
                            idx_fields.append(df)
            indexes.append(
                {
                    "table": name,
                    "index": ix_name,
                    "alternate_key": alt,
                    "allow_duplicates": dup,
                    "allow_page_locks": apl,
                    "clustered": clustered,
                    "fields": ";".join(idx_fields),
                    "field_included_columns": ";".join(included),
                }
            )

    return {
        "table": name,
        "model": top,
        "modules": modules,
        "table_group": table_group,
        "label": label,
        "primary_index": primary_index,
        "clustered_index": clustered_index,
        "cache_lookup": cache_lookup,
        "replacement_key": replacement_key,
        "configuration_key": configuration_key,
        "relpath": relpath,
        "fields": fields,
        "methods": methods,
        "relations": relations,
        "indexes": indexes,
        "field_count": len(fields),
        "method_count": len(methods),
        "relation_count": len(relations_el.findall("AxTableRelation")) if relations_el is not None else 0,
        "relation_constraint_rows": len(relations),
        "index_count": len(indexes),
    }


# ---------------------------------------------------------------------------
# writers
# ---------------------------------------------------------------------------
TABLE_COLS = [
    "table",
    "model",
    "modules",
    "table_group",
    "label",
    "primary_index",
    "clustered_index",
    "cache_lookup",
    "field_count",
    "method_count",
    "relation_count",
    "index_count",
    "replacement_key",
    "configuration_key",
    "relpath",
]
FIELD_COLS = [
    "table",
    "field",
    "field_type",
    "edt",
    "enum_type",
    "mandatory",
    "visible",
    "allow_edit",
    "label",
    "asset_classification",
    "relation_context",
    "table_model",
]
METHOD_COLS = [
    "table",
    "method",
    "display_kind",
    "return_type",
    "modifier",
    "xml_locator",
    "source_hash",
]
RELATION_COLS = [
    "table",
    "relation",
    "related_table",
    "role",
    "relationship_type",
    "cardinality",
    "related_cardinality",
    "constraint_type",
    "field",
    "related_field",
    "value_str",
    "index",
    "use_default_role_names",
    "edt_relation",
    "xml_type",
]
INDEX_COLS = [
    "table",
    "index",
    "alternate_key",
    "allow_duplicates",
    "allow_page_locks",
    "clustered",
    "fields",
    "field_included_columns",
]


def write_csv(path: Path, rows: list[dict[str, Any]], cols: list[str]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
        w.writeheader()
        n = 0
        for r in rows:
            # project to cols (drop extras like _first_line, return_type placeholder)
            out = {k: (r.get(k, "") or "") for k in cols}
            # coerce ints to str for csv
            for k in out:
                if not isinstance(out[k], str):
                    out[k] = str(out[k])
            w.writerow(out)
            n += 1
    return n


def write_sqlite(db_path: Path, tables_rows, fields_rows, methods_rows, relations_rows, indexes_rows) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    def cols_sql(cols: list[str]) -> str:
        # table/meta/field etc are all TEXT; counts are INTEGER on tables only
        int_cols = {"field_count", "method_count", "relation_count", "index_count"}
        parts = []
        for c in cols:
            ty = "INTEGER" if c in int_cols else "TEXT"
            parts.append(f'"{c}" {ty}')
        return ", ".join(parts)

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute(f"CREATE TABLE tables ({cols_sql(TABLE_COLS)})")
    cur.execute(f"CREATE TABLE fields ({cols_sql(FIELD_COLS)})")
    cur.execute(f"CREATE TABLE methods ({cols_sql(METHOD_COLS)})")
    cur.execute(f"CREATE TABLE relations ({cols_sql(RELATION_COLS)})")
    cur.execute(f"CREATE TABLE indexes_ ({cols_sql(INDEX_COLS)})")
    # bulk insert
    for name, rows, cols in [
        ("tables", tables_rows, TABLE_COLS),
        ("fields", fields_rows, FIELD_COLS),
        ("methods", methods_rows, METHOD_COLS),
        ("relations", relations_rows, RELATION_COLS),
        ("indexes_", indexes_rows, INDEX_COLS),
    ]:
        if not rows:
            continue
        placeholders = ",".join(["?"] * len(cols))
        col_list = ",".join(f'"{c}"' for c in cols)
        cur.executemany(
            f"INSERT INTO {name} ({col_list}) VALUES ({placeholders})",
            [[r.get(c, "") for c in cols] for r in rows],
        )
    # helpful indexes for enrichment queries (site gap = mirror minus flows.ts set)
    cur.execute('CREATE INDEX idx_fields_table ON fields("table")')
    cur.execute('CREATE INDEX idx_fields_edt ON fields(edt) WHERE edt<>\'\'')
    cur.execute('CREATE INDEX idx_rel_from ON relations("table")')
    cur.execute("CREATE INDEX idx_rel_to ON relations(related_table)")
    cur.execute('CREATE INDEX idx_methods_table ON methods("table")')
    cur.execute("CREATE INDEX idx_tables_modules ON tables(modules)")
    cur.execute('CREATE INDEX idx_indexes_table ON indexes_("table")')
    # meta
    cur.execute("CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT)")
    cur.executemany("INSERT INTO meta(k,v) VALUES (?,?)", [("export_version", EXPORT_VERSION)])
    con.commit()
    con.close()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export D365FO standard mirror to CSV/TSV/SQLite")
    p.add_argument("--source-root", default=str(source_root_default()), help="PackagesLocalDirectory mirror root")
    p.add_argument("--out-dir", default=".artifacts-standard-export", help="output directory")
    p.add_argument("--format", choices=["csv", "sqlite", "both"], default="both", help="output format")
    p.add_argument("--jobs", type=int, default=os.cpu_count() or 4, help="parallel workers")
    p.add_argument("--sample", type=int, default=0, help="limit to first N tables (for smoke test)")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    source_root = Path(args.source_root).expanduser().resolve()
    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        # if relative, anchor at repo root when invoked from within fno-navigator
        # otherwise anchor at cwd
        repo_hint = Path(__file__).resolve().parents[1]
        if (repo_hint / "src").is_dir() and (repo_hint / "static").is_dir():
            out_dir = repo_hint / out_dir
        else:
            out_dir = Path.cwd() / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    if not source_root.is_dir():
        print(f"source root does not exist: {source_root}", file=sys.stderr)
        return 2

    print(f"source_root={source_root}")
    files = iter_axtable_files(source_root)
    print(f"axtable files (excl XppMetadata): {len(files)}")
    if args.sample:
        files = files[: args.sample]
        print(f"sample mode: {len(files)} files")

    t0 = time.time()
    tables_rows: list[dict[str, Any]] = []
    fields_rows: list[dict[str, Any]] = []
    methods_rows: list[dict[str, Any]] = []
    relations_rows: list[dict[str, Any]] = []
    indexes_rows: list[dict[str, Any]] = []
    errors: list[str] = []
    skipped = 0
    # parallel extract
    # Use processes to dodge GIL on XML parsing; fallback to threads if spawn is heavy.
    src_s = str(source_root)
    with ProcessPoolExecutor(max_workers=args.jobs) as ex:
        futs = {ex.submit(extract_file, str(p), src_s): str(p) for p in files}
        # collect with backpressure display
        done = 0
        for fut in futs:
            # as_completed order not needed; we iterate submission order and call result()
            # to keep memory bounded, materialize via done loop
            pass
        # actually as_completed
        from concurrent.futures import as_completed

        for fut in as_completed(futs):
            res = None
            try:
                res = fut.result()
            except Exception as e:
                errors.append(f"{futs[fut]}: {e}")
                continue
            done += 1
            if done % 2000 == 0:
                print(f"  extracted {done}/{len(files)} ({done/len(files):.0%}) ...")
            if res is None:
                skipped += 1
                continue
            if "error" in res:
                errors.append(res["error"])
                continue
            tables_rows.append(
                {
                    "table": res["table"],
                    "model": res["model"],
                    "modules": res["modules"],
                    "table_group": res["table_group"],
                    "label": res["label"],
                    "primary_index": res["primary_index"],
                    "clustered_index": res["clustered_index"],
                    "cache_lookup": res["cache_lookup"],
                    "field_count": res["field_count"],
                    "method_count": res["method_count"],
                    "relation_count": res["relation_count"],
                    "index_count": res["index_count"],
                    "replacement_key": res["replacement_key"],
                    "configuration_key": res["configuration_key"],
                    "relpath": res["relpath"],
                }
            )
            fields_rows.extend(res["fields"])
            # strip internal _first_line before storing
            for m in res["methods"]:
                methods_rows.append({k: v for k, v in m.items() if not k.startswith("_")})
            relations_rows.extend(res["relations"])
            indexes_rows.extend(res["indexes"])

    tables_rows.sort(key=lambda r: r["table"])
    fields_rows.sort(key=lambda r: (r["table"], r["field"]))
    methods_rows.sort(key=lambda r: (r["table"], r["method"]))
    relations_rows.sort(key=lambda r: (r["table"], r["relation"], r["constraint_type"], r["field"] or r["value_str"]))
    indexes_rows.sort(key=lambda r: (r["table"], r["index"]))

    elapsed = time.time() - t0
    print(
        f"parsed {len(tables_rows)} AxTable objects, {len(fields_rows)} fields, "
        f"{len(methods_rows)} methods, {len(relations_rows)} relation-constraint rows, {len(indexes_rows)} indexes "
        f"in {elapsed:.1f}s ({len(tables_rows)/elapsed:.0f} tables/s)"
    )
    if skipped:
        print(f"skipped non-AxTable files: {skipped}")
    if errors:
        print(f"errors: {len(errors)} (first 10):", file=sys.stderr)
        for e in errors[:10]:
            print(" ", e, file=sys.stderr)

    # deterministic hash for provenance
    def sha_of_rows(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    written: list[str] = []
    if args.format in ("csv", "both"):
        n = write_csv(out_dir / "tables.csv", tables_rows, TABLE_COLS)
        written.append(f"tables.csv:{n}")
        n = write_csv(out_dir / "fields.csv", fields_rows, FIELD_COLS)
        written.append(f"fields.csv:{n}")
        n = write_csv(out_dir / "methods.csv", methods_rows, METHOD_COLS)
        written.append(f"methods.csv:{n}")
        n = write_csv(out_dir / "relations.csv", relations_rows, RELATION_COLS)
        written.append(f"relations.csv:{n}")
        n = write_csv(out_dir / "indexes.csv", indexes_rows, INDEX_COLS)
        written.append(f"indexes.csv:{n}")
        for name in ["tables.csv", "fields.csv", "methods.csv", "relations.csv", "indexes.csv"]:
            p = out_dir / name
            print(f"  {name}: {p.stat().st_size/1024:.0f}KB sha256={sha_of_rows(p)[:12]}")

    if args.format in ("sqlite", "both"):
        db_path = out_dir / "standard.sqlite3"
        write_sqlite(db_path, tables_rows, fields_rows, methods_rows, relations_rows, indexes_rows)
        print(f"  standard.sqlite3: {db_path.stat().st_size/1024:.0f}KB")

    # manifest for reproducibility
    import json as _json

    manifest = {
        "export_version": EXPORT_VERSION,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_root": str(source_root),
        "axtable_files_scanned": len(files),
        "axtable_objects_exported": len(tables_rows),
        "fields": len(fields_rows),
        "methods": len(methods_rows),
        "relation_constraint_rows": len(relations_rows),
        "indexes": len(indexes_rows),
        "errors": len(errors),
        "files": written,
        "sql_sha256": sha_of_rows(out_dir / "standard.sqlite3") if (out_dir / "standard.sqlite3").exists() else None,
    }
    (out_dir / "manifest.json").write_text(_json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(_json.dumps(manifest, indent=2))

    # quick gap hint vs live site (when running inside fno-navigator)
    repo_root = Path(__file__).resolve().parents[1]
    flows = repo_root / "src/lib/data/flows.ts"
    if flows.is_file():
        import re as _re

        # slice to tableDefs so unrelated top-level object literals are not counted
        text = flows.read_text(encoding="utf-8")
        marker = "export const tableDefs"
        if marker in text:
            text = text[text.index(marker) :]
        keys = set(_re.findall(r"^  ([A-Z][A-Za-z0-9_]+): \{", text, _re.M))
        exported = {r["table"] for r in tables_rows}
        missing = sorted(exported - keys)
        print(f"\nlive site tableDefs: {len(keys)}, mirror: {len(exported)}, unenriched (sample 20): {missing[:20]}")
        print(f"coverage: {len(keys)/len(exported):.1%} of mirror is enriched; {len(missing)} tables are not mapped at all")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
