import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import request from "supertest";
import { createDataService } from "../db/service.js";
import { createDataRouter } from "../db/router.js";
import { eligible, scheduledDays } from "../db/attendance-operations.js";
test("Schedule and effective enrollment boundaries", () => {
  assert.deepEqual(scheduledDays({ schedule: "T2, Thứ 4, CN" }), [0, 1, 3]);
  assert.equal(
    eligible({ status: "transferred", ends_on: "2026-10-01" }, "2026-09-30"),
    true,
  );
  assert.equal(
    eligible({ status: "transferred", ends_on: "2026-10-01" }, "2026-10-01"),
    false,
  );
});
test("Transactional attendance operations", async (t) => {
  const pg = new PGlite(),
    sql = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  await pg.exec(sql);
  await pg.exec(sql);
  const db = {
      query: (s, v) => pg.query(s, v),
      transaction: (fn) => pg.transaction((tx) => fn(tx)),
    },
    s = createDataService(db),
    classId = "2026-2027:TEST";
  await s.createClass(
    { id: "TEST", name: "Toán", academicYear: "2026-2027", tuition: "1000000" },
    "admin",
  );
  const a = (await s.createStudent({ name: "A", classes: classId }, "admin"))
      .student.id,
    b = (await s.createStudent({ name: "B", classes: classId }, "admin"))
      .student.id;
  const save = (date, records, extra = {}) =>
    s.saveAttendance({ classId, date, records, ...extra }, "ta");
  try {
    await t.test("notes and idempotent retry", async () => {
      const body = {
        classId,
        date: "2026-10-01",
        requestId: "test-1",
        records: [{ id: a, status: "Có mặt", note: "Ghi chú", version: 0 }],
      };
      const first = await s.saveAttendance(body, "ta");
      assert.deepEqual(await s.saveAttendance(body, "ta"), first);
      assert.equal(
        (await s.attendanceList(classId, "2026-10-01")).find((x) => x.id === a)
          .note,
        "Ghi chú",
      );
      await assert.rejects(
        s.saveAttendance(
          { ...body, records: [{ ...body.records[0], note: "khác" }] },
          "ta",
        ),
        /nội dung khác/,
      );
      await assert.rejects(
        save("2026-10-01", [{ id: a, status: "Vắng", version: 0 }]),
        /đã đổi/,
      );
    });
    await t.test("stale batch rolls back and version required", async () => {
      await assert.rejects(
        save("2026-10-01", [
          { id: b, status: "Vắng", version: 0 },
          { id: a, status: "Vắng", version: 0 },
        ]),
      );
      assert.equal(
        (await s.attendanceList(classId, "2026-10-01")).find((x) => x.id === b)
          .version,
        0,
      );
      await assert.rejects(
        save("2026-10-01", [{ id: a, status: "Vắng" }]),
        /phiên bản/,
      );
    });
    await t.test("two sessions and versioned unmark", async () => {
      await s.createSession(
        {
          classId,
          date: "2026-10-01",
          sessionKey: "chieu",
          label: "Chiều",
          reason: "Hai ca",
        },
        "admin",
      );
      await save(
        "2026-10-01",
        [{ id: a, status: "Đi trễ", note: "10 phút", version: 0 }],
        { sessionKey: "chieu" },
      );
      assert.equal(
        (await s.attendanceList(classId, "2026-10-01", "chieu")).find(
          (x) => x.id === a,
        ).status,
        "Đi trễ",
      );
      assert.equal(
        (await s.attendanceList(classId, "2026-10-01")).find((x) => x.id === a)
          .status,
        "Có mặt",
      );
      await save(
        "2026-10-01",
        [{ id: a, status: null, note: "Chờ", version: 1 }],
        { sessionKey: "chieu" },
      );
      assert.equal(
        (await s.attendanceList(classId, "2026-10-01", "chieu")).find(
          (x) => x.id === a,
        ).version,
        2,
      );
    });
    await t.test(
      "absence tasks deduplicate; makeup retains original absence",
      async () => {
        await save("2026-10-02", [{ id: a, status: "Vắng", version: 0 }]);
        await save("2026-10-03", [{ id: a, status: "Vắng", version: 0 }]);
        assert.equal(
          (await s.tasks()).filter((x) => x.status === "open").length,
          1,
        );
        await save("2026-10-04", [{ id: a, status: "Vắng", version: 0 }]);
        assert.equal(
          (await s.tasks()).filter((x) => x.status === "open").length,
          1,
        );
        await s.createMakeup(
          {
            studentId: a,
            sourceClass: classId,
            sourceDate: "2026-10-03",
            targetClass: classId,
            targetDate: "2026-10-05",
          },
          "admin",
        );
        assert.equal(
          (await s.attendanceList(classId, "2026-10-05")).find(
            (x) => x.id === a,
          ).isMakeup,
          true,
        );
        await save("2026-10-05", [{ id: a, status: "Có mặt", version: 0 }]);
        assert.equal(
          (await s.tasks()).filter((x) => x.status === "open").length,
          0,
        );
        assert.equal(
          (await s.attendanceList(classId, "2026-10-03")).find(
            (x) => x.id === a,
          ).status,
          "Vắng",
        );
      },
    );
    await t.test("historical correction and transfer date", async () => {
      await s.setEnrollment(
        { studentId: b, classId, startsOn: "2026-10-01", endsOn: "2026-10-04" },
        "admin",
      );
      await save("2026-10-03", [
        { id: b, status: "Vắng có phép", note: "Xin nghỉ", version: 0 },
      ]);
      await assert.rejects(
        save("2026-10-04", [{ id: b, status: "Có mặt", version: 0 }]),
        /không thuộc lớp/,
      );
    });
    await t.test("pending deduplication and atomic admission", async () => {
      const body = {
        classId,
        className: "Toán",
        date: "2026-10-01",
        studentName: "Mới",
        requestId: "report-1",
      };
      const p = await s.createPending(body, "ta");
      assert.equal((await s.createPending(body, "ta")).id, p.id);
      assert.equal(
        (await s.createPending({ ...body, requestId: "report-2" }, "ta")).id,
        p.id,
      );
      const created = await s.enrollPending(p.id, {}, "admin");
      await s.enrollPending(p.id, {}, "admin");
      assert.ok(
        (await s.attendanceList(classId, "2026-10-01")).some(
          (x) => x.id === created.studentId,
        ),
      );
      assert.equal(
        (await s.students()).filter((x) => x.name === "Mới").length,
        1,
      );
    });
    await t.test(
      "re-enrollment keeps historical gaps and transfer is atomic",
      async () => {
        const c = (
          await s.createStudent({ name: "C", classes: classId }, "admin")
        ).student.id;
        await s.setEnrollment(
          {
            studentId: c,
            classId,
            startsOn: "2026-09-01",
            endsOn: "2026-10-03",
          },
          "admin",
        );
        await s.setEnrollment(
          { studentId: c, classId, startsOn: "2026-10-06" },
          "admin",
        );
        assert.equal(
          (await s.attendanceList(classId, "2026-10-02")).find(
            (x) => x.id === c,
          ).isTransferred,
          false,
        );
        assert.equal(
          (await s.attendanceList(classId, "2026-10-04")).find(
            (x) => x.id === c,
          ).isTransferred,
          true,
        );
        assert.equal(
          (await s.attendanceList(classId, "2026-10-07")).find(
            (x) => x.id === c,
          ).isTransferred,
          false,
        );
        await assert.rejects(
          s.setEnrollment(
            { studentId: c, classId, startsOn: "2026-10-02" },
            "admin",
          ),
          /trùng/,
        );
        await s.createClass(
          { id: "NEXT", name: "Lớp mới", academicYear: "2026-2027" },
          "admin",
        );
        await s.setEnrollment(
          {
            studentId: c,
            classId,
            startsOn: "2026-10-06",
            endsOn: "2026-10-09",
            targetClass: "2026-2027:NEXT",
          },
          "admin",
        );
        assert.equal(
          (await s.attendanceList("2026-2027:NEXT", "2026-10-09")).find(
            (x) => x.id === c,
          ).isTransferred,
          false,
        );
        assert.equal((await s.studentDetail(c)).periods.length, 3);
      },
    );
    await t.test("families, discount and student results", async () => {
      await s.setFamily(
        { name: "Gia đình", studentIds: [a, b], discountPercent: 10 },
        "admin",
      );
      assert.equal((await s.feeQuote(a, classId)).amount, 900000);
      await s.saveResult(
        {
          studentId: a,
          classId,
          title: "Kiểm tra",
          date: "2026-10-01",
          score: 8.5,
          maximum: 10,
        },
        "admin",
      );
      assert.equal((await s.studentDetail(a)).results.length, 1);
      await assert.rejects(
        s.saveResult(
          {
            studentId: a,
            classId,
            title: "Sai",
            date: "2026-10-01",
            score: 11,
            maximum: 10,
          },
          "admin",
        ),
      );
    });
    await t.test("office authorization", async () => {
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        req.user = { role: "trogiang", username: "ta" };
        next();
      });
      app.use("/api", createDataRouter(s));
      for (const path of [
        "/parent-tasks",
        "/attendance/report?classId=" + classId,
        "/tuition",
      ])
        assert.equal((await request(app).get("/api" + path)).status, 403);
      for (const path of [
        "/attendance/sessions",
        "/enrollments",
        "/families",
        "/results",
        "/makeups",
      ])
        assert.equal(
          (
            await request(app)
              .post("/api" + path)
              .send({})
          ).status,
          403,
        );
    });
  } finally {
    await pg.close();
  }
});

test("v1 migration preserves existing marks and supports repeat execution", async () => {
  const pg = new PGlite();
  try {
    const sql = await readFile(
      new URL("../db/schema.sql", import.meta.url),
      "utf8",
    );
    await pg.exec(sql.split("-- Attendance operations v2.")[0]);
    await pg.exec(
      "INSERT INTO students(id,name) VALUES('OLD','Old'); INSERT INTO classes(id,name,academic_year,kind) VALUES('OLD','Old','2026-2027','manual'); INSERT INTO enrollments(student_id,class_id) VALUES('OLD','OLD'); INSERT INTO attendance(student_id,class_id,attendance_date,status,note,version) VALUES('OLD','OLD','2026-10-01','Có mặt','Keep me',7)",
    );
    await pg.exec(sql);
    await pg.exec(sql);
    const row = (await pg.query("SELECT * FROM attendance")).rows[0];
    assert.equal(row.note, "Keep me");
    assert.equal(row.version, 7);
    assert.equal(row.session_key, "default");
  } finally {
    await pg.close();
  }
});
