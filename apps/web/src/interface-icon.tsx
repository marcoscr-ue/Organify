const paths = {
  inbox: "M4 4h16l2 10v5H2v-5L4 4Zm-2 10h6l2 3h4l2-3h6",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  calendar:
    "M7 3v4m10-4v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M18 6 6 18",
  terminal: "M4 5h16v14H4zM7 9l3 3-3 3m5 0h5",
  board: "M3 4h8v16H3zM15 4h6v9h-6z",
  search: "m16 16 4 4m-2-9a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  plus: "M12 5v14M5 12h14",
  chevron: "m6 9 6 6 6-6",
  up: "m6 11 6-6 6 6m-6-6v14",
  down: "m6 13 6 6 6-6m-6 6V5",
  flame:
    "M10 3c1 4-4 5-4 10a6 6 0 0 0 12 0c0-3-2-5-4-7 0 3-1 4-2 4 1-3 0-5-2-7Z",
  check: "m5 12 4 4L19 6",
  edit: "m14 5 5 5M4 20l4-.8L20 7l-3-3L5 16l-1 4Z",
  save: "M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7",
  reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
  popout: "M13 4h7v7m0-7-9 9m6 0v7H4V7h7",
  expand: "M12 3v18m-4-14 4-4 4 4m-8 10 4 4 4-4",
  collapse: "M12 3v6m0 6v6M8 5l4 4 4-4m-8 14 4-4 4 4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  filter: "M4 7h16M4 17h16M8 4v6m8 4v6",
  bell: "M9 20a3 3 0 0 0 6 0M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Z",
  sparkles:
    "M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z",
};

export function InterfaceIcon({
  name,
  className = "size-4",
}: {
  name: keyof typeof paths;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
