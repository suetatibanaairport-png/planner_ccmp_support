import { describe, expect, it } from "vitest";
import { parseCsv, toRecords } from "./parseCsv";

describe("parseCsv", () => {
  it("BOM を除去する", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("CRLF / LF いずれも改行として扱う", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("引用符内の改行・カンマを1フィールドとして扱う", () => {
    expect(parseCsv('a,"line1\nline2,with comma",c')).toEqual([
      ["a", "line1\nline2,with comma", "c"],
    ]);
  });

  it('"" によるエスケープを解釈する', () => {
    expect(parseCsv('a,"say ""hi""",c')).toEqual([["a", 'say "hi"', "c"]]);
  });

  it("末尾の完全な空行を除去する", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("空文字列は0行", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("toRecords", () => {
  it("1行目をヘッダーとして列名キーのオブジェクトに変換する", () => {
    const { header, records } = toRecords([
      ["タスク ID", "タスク名"],
      ["T1", "タスクA"],
    ]);
    expect(header).toEqual(["タスク ID", "タスク名"]);
    expect(records).toEqual([{ "タスク ID": "T1", タスク名: "タスクA" }]);
  });

  it("行数がヘッダーのみの場合は空配列", () => {
    expect(toRecords([["a", "b"]]).records).toEqual([]);
  });
});
