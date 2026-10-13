import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
const dom = new JSDOM('<div id="root"></div>', {
  url: "http://localhost/attendance",
});
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "Event",
  "MouseEvent",
  "CustomEvent",
  "localStorage",
])
  globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
localStorage.setItem("edu_user", "tester");
localStorage.setItem("edu_role", "trogiang");
const React = await import("react"),
  { act } = React,
  { createRoot } = await import("react-dom/client");
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
const api = (await vite.ssrLoadModule("/src/utils/api.ts")).default;
const Component = (await vite.ssrLoadModule("/src/pages/Attendance.tsx"))
  .default;
let rows = Array.from({ length: 16 }, (_, i) => ({
  id: "HS" + i,
  name: "Học sinh " + i,
  status: null,
  note: "",
  version: 0,
  isTransferred: false,
}));
let posts = [],
  fail = false,
  confirmation = 0;
window.confirm = () => {
  confirmation++;
  return true;
};
api.get = async (url) => ({
  data:
    url === "/api/classes"
      ? [
          { id: "C1", name: "Toán K1" },
          { id: "C2", name: "Toán K2" },
        ]
      : url.endsWith("/capabilities")
        ? { backend: "postgres", sessions: true, operations: true }
        : url.endsWith("/sessions")
          ? [{ session_key: "default", label: "Buổi thường" }]
          : url.includes("/class/")
            ? structuredClone(rows)
            : [],
});
api.post = async (url, payload) => {
  posts.push({ url, payload });
  if (fail)
    throw { response: { status: 409, data: { error: "Dữ liệu đã đổi" } } };
  const versions = {};
  if (url === "/api/attendance")
    for (const mark of payload.records) {
      const row = rows.find((x) => x.id === mark.id);
      Object.assign(row, mark, { version: row.version + 1 });
      versions[row.id] = row.version;
    }
  return {
    data: { success: true, versions, savedAt: new Date().toISOString() },
  };
};
let root;
const render = async () => {
  root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(React.createElement(Component));
  });
};
const button = (name) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === name);
const click = async (b) => {
  assert.ok(b);
  await act(async () =>
    b.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
};
const change = async (el, value) => {
  assert.ok(el);
  await act(async () => {
    const proto =
      el.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
};
try {
  await test("Changed-row save spans pages, preserves notes and counts late arrivals", async () => {
    await render();
    assert.ok(document.body.textContent.includes("Chưa điểm danh: 16"));
    await change(
      document.querySelector('[aria-label="Trạng thái Học sinh 0"]'),
      "Có mặt",
    );
    await change(
      document.querySelector('[aria-label="Ghi chú Học sinh 0"]'),
      "Ghi chú cần giữ",
    );
    assert.ok(localStorage.length > 2);
    await click(button("Trang sau"));
    await change(
      document.querySelector('[aria-label="Trạng thái Học sinh 15"]'),
      "Đi trễ",
    );
    assert.ok(document.body.textContent.includes("Đã đến lớp: 2"));
    await click(button("Lưu điểm danh"));
    assert.equal(posts[0].payload.records.length, 2);
    assert.equal(posts[0].payload.records[0].note, "Ghi chú cần giữ");
    assert.equal(button("Lưu điểm danh").disabled, true);
    assert.ok(confirmation > 0);
  });
  await test("Draft survives unmount and conflicts preserve edits", async () => {
    await click(button("Trang trước"));
    await change(
      document.querySelector('[aria-label="Ghi chú Học sinh 0"]'),
      "Nháp",
    );
    await act(async () => root.unmount());
    await render();
    assert.ok(button("Khôi phục bản nháp"));
    await click(button("Khôi phục bản nháp"));
    assert.equal(
      document.querySelector('[aria-label="Ghi chú Học sinh 0"]').value,
      "Nháp",
    );
    fail = true;
    await click(button("Lưu điểm danh"));
    assert.ok(document.body.textContent.includes("Dữ liệu đã đổi"));
    assert.equal(button("Lưu điểm danh").disabled, false);
    assert.ok(
      [...Array(localStorage.length)].some((_, i) =>
        localStorage.key(i).startsWith("lt1-attendance:"),
      ),
    );
    fail = false;
  });
  await test("Empty roster can report student and assistants have no office operations", async () => {
    await act(async () => root.unmount());
    localStorage.clear();
    localStorage.setItem("edu_user", "tester");
    localStorage.setItem("edu_role", "trogiang");
    rows = [];
    await render();
    assert.ok(button("Gửi báo cáo lên Văn phòng"));
    assert.equal(
      button("Văn phòng: buổi học, học bù và chuyên cần"),
      undefined,
    );
  });
} finally {
  if (root) await act(async () => root.unmount());
  await vite.close();
  dom.window.close();
}
