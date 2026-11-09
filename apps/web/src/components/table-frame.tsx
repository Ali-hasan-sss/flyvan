import type { ReactNode } from "react";
import { Button } from "@flyvan/ui";

export type TableSort = {
  id: string;
  label: string;
  icon: "user" | "calendar" | "activity" | "plate";
};

type TableFrameProps = {
  sorts: TableSort[];
  sort: string;
  onSort: (id: string) => void;
  direction: "asc" | "desc";
  onDirection: () => void;
  search: string;
  onSearch: (value: string) => void;
  pageSize: string;
  onPageSize: (value: string) => void;
  page: number;
  pageCount: number;
  total: number;
  totalLabel: string;
  onPage: (page: number) => void;
  loading: boolean;
  headers: string[];
  empty: string;
  isEmpty: boolean;
  extra?: ReactNode;
  children: ReactNode;
};

export function TableFrame({
  sorts,
  sort,
  onSort,
  direction,
  onDirection,
  search,
  onSearch,
  pageSize,
  onPageSize,
  page,
  pageCount,
  total,
  totalLabel,
  onPage,
  loading,
  headers,
  empty,
  isEmpty,
  extra,
  children,
}: TableFrameProps) {
  return (
    <div className="fv-table-wrap">
      <div className="fv-table-toolbar">
        {extra}
        <input
          className="fv-input fv-table-search"
          value={search}
          placeholder="بحث في كل الصفحات"
          aria-label="بحث في كل الصفحات"
          onChange={(event) => onSearch(event.target.value)}
        />
        <select
          className="fv-input fv-table-size"
          value={pageSize}
          aria-label="عدد الصفوف"
          onChange={(event) => onPageSize(event.target.value)}
        >
          <option value="10">10</option>
          <option value="15">15</option>
          <option value="25">25</option>
        </select>
        <div className="fv-table-sorts">
          {sorts.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant={sort === item.id ? "teal" : "secondary"}
              className="fv-table-sort"
              aria-pressed={sort === item.id}
              onClick={() => onSort(item.id)}
            >
              <SortIcon name={item.icon} />
              {item.label}
            </Button>
          ))}
          <button
            type="button"
            className="fv-icon-button"
            aria-label={direction === "asc" ? "ترتيب تصاعدي" : "ترتيب تنازلي"}
            onClick={onDirection}
          >
            <SortIcon name={direction === "asc" ? "up" : "down"} />
          </button>
        </div>
      </div>
      <table className="fv-table">
        <colgroup>
          {headers.map((header) => (
            <col key={header} className={header === "إجراء" ? "fv-actions-col" : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className={header === "إجراء" ? "fv-actions-col" : undefined}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 6 }, (_, row) => (
                <tr key={row}>
                  {headers.map((header) => (
                    <td key={header}>
                      <span className="fv-skel" />
                    </td>
                  ))}
                </tr>
              ))
            : isEmpty ? (
                <tr>
                  <td colSpan={headers.length}>{empty}</td>
                </tr>
              ) : (
                children
              )}
        </tbody>
      </table>
      <div className="fv-table-footer">
        <Button type="button" variant="secondary" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
          السابق
        </Button>
        <span className="text-sm text-muted">
          صفحة {page} من {pageCount} — {total} {totalLabel}
        </span>
        <Button
          type="button"
          variant="secondary"
          disabled={page >= pageCount || loading}
          onClick={() => onPage(page + 1)}
        >
          التالي
        </Button>
      </div>
    </div>
  );
}

function SortIcon({ name }: { name: TableSort["icon"] | "up" | "down" }) {
  if (name === "up" || name === "down") {
    return (
      <svg className="fv-table-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d={name === "up" ? "M12 19V6M7 11l5-5 5 5" : "M12 5v13M7 13l5 5 5-5"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  const paths: Record<TableSort["icon"], string> = {
    user: "M12 12a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM5.5 19c1.3-2.8 3.6-4.2 6.5-4.2s5.2 1.4 6.5 4.2",
    calendar: "M7 4v2M17 4v2M5 9h14M6 6h12a1 1 0 0 1 1 1v12H5V7a1 1 0 0 1 1-1z",
    activity: "M4 15l4-5 3 3 5-7 4 5",
    plate: "M4 8h16v8H4V8zm3 2.5h2M4 12h16",
  };
  return (
    <svg className="fv-table-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
