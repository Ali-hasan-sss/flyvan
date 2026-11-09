"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { EmptyState } from "./states";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  searchableText?: (row: T) => string;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  emptyTitle: string;
  emptyDescription: string;
  pageSize?: number;
  searchLabel?: string;
};

export function DataTable<T>({
  columns,
  rows,
  emptyTitle,
  emptyDescription,
  pageSize = 10,
  searchLabel = "بحث في السجلات المعروضة",
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return rows;
    }
    return rows.filter((row) =>
      columns.some((column) => (column.searchableText?.(row) ?? "").toLowerCase().includes(needle)),
    );
  }, [columns, query, rows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  return (
    <div className="fv-stack">
      <div className="fv-toolbar">
        <label className="fv-field" style={{ minWidth: "16rem", flex: "1 1 16rem" }}>
          <span className="fv-label">{searchLabel}</span>
          <input
            className="fv-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <p className="fv-hint">
          {filtered.length} سجل — الصفحة {currentPage} من {pageCount}
        </p>
      </div>
      <div className="fv-table-wrap">
        <table className="fv-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </td>
              </tr>
            ) : (
              visible.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.key}>{column.cell(row)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="fv-row">
        <Button
          variant="secondary"
          disabled={currentPage <= 1}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          السابق
        </Button>
        <Button
          variant="secondary"
          disabled={currentPage >= pageCount}
          onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
        >
          التالي
        </Button>
      </div>
    </div>
  );
}
