// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { HumiModule } from "./HumiModule";
import { KnowledgeModule } from "./KnowledgeModule";

const modulePaths = [
  resolve(process.cwd(), "src/components/Hub/HumiModule.tsx"),
  resolve(process.cwd(), "src/components/Hub/KnowledgeModule.tsx"),
];

function numericLiteralText(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (ts.isNumericLiteral(node) || ts.isStringLiteral(node)) {
    return node.text;
  }
  return node.getText(sourceFile).match(/^["'](.+)["']$/)?.[1];
}

function objectDimension(
  object: ts.ObjectLiteralExpression,
  name: "width" | "height",
  sourceFile: ts.SourceFile,
): number | undefined {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      candidate.name.getText(sourceFile) === name,
  );
  if (!property) return undefined;

  const value = Number(numericLiteralText(property.initializer, sourceFile));
  return Number.isFinite(value) ? value : undefined;
}

function jsxDimension(
  node: ts.Node,
  name: "width" | "height",
  sourceFile: ts.SourceFile,
): number | undefined {
  let current: ts.Node | undefined = node;

  while (current) {
    const attributes = ts.isJsxElement(current)
      ? current.openingElement.attributes
      : ts.isJsxSelfClosingElement(current)
        ? current.attributes
        : undefined;
    const attribute = attributes?.properties.find(
      (candidate): candidate is ts.JsxAttribute =>
        ts.isJsxAttribute(candidate) &&
        candidate.name.getText(sourceFile) === name,
    );

    if (attribute?.initializer) {
      const initializer = ts.isJsxExpression(attribute.initializer)
        ? attribute.initializer.expression
        : attribute.initializer;
      if (initializer) {
        const value = Number(numericLiteralText(initializer, sourceFile));
        return Number.isFinite(value) ? value : undefined;
      }
    }
    current = current.parent;
  }

  return undefined;
}

function isFixedCircle(
  property: ts.PropertyAssignment,
  radius: string,
  sourceFile: ts.SourceFile,
): boolean {
  const numericRadius = Number.parseFloat(radius);
  if (
    radius !== "50%" &&
    (!Number.isFinite(numericRadius) || numericRadius < 999)
  ) {
    return false;
  }
  if (!ts.isObjectLiteralExpression(property.parent)) return false;

  const width =
    objectDimension(property.parent, "width", sourceFile) ??
    jsxDimension(property, "width", sourceFile);
  const height =
    objectDimension(property.parent, "height", sourceFile) ??
    jsxDimension(property, "height", sourceFile);

  return width !== undefined && width === height;
}

function sourceRadiusViolations(path: string): string[] {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sourceFile) === "borderRadius"
    ) {
      const radius = numericLiteralText(node.initializer, sourceFile);
      const numericRadius = Number.parseFloat(radius ?? "");

      if (
        Number.isFinite(numericRadius) &&
        numericRadius > 8 &&
        !isFixedCircle(node, radius ?? "", sourceFile)
      ) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1;
        violations.push(`${basename(path)}:${line} (${radius})`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function renderedRadiusViolations(html: string): string[] {
  const host = document.createElement("div");
  host.innerHTML = html;

  return Array.from(host.querySelectorAll<HTMLElement>("[style]")).flatMap(
    (element) => {
      const radius = element.style.borderRadius;
      const numericRadius = Number.parseFloat(radius);
      if (!Number.isFinite(numericRadius) || numericRadius <= 8) return [];

      const width = Number.parseFloat(
        element.style.width || element.getAttribute("width") || "",
      );
      const height = Number.parseFloat(
        element.style.height || element.getAttribute("height") || "",
      );
      const circleRadius = radius === "50%" || numericRadius >= 999;
      if (circleRadius && Number.isFinite(width) && width === height) return [];

      return [`<${element.tagName.toLowerCase()}> (${radius})`];
    },
  );
}

describe("Hub inline radius contract", () => {
  it("keeps non-circular Humi and Knowledge source radii at 8px or less", () => {
    const violations = modulePaths.flatMap(sourceRadiusViolations);

    expect(violations).toEqual([]);
  });

  it("keeps rendered non-circular Hub controls at 8px or less", () => {
    const html = renderToStaticMarkup(
      <>
        <HumiModule />
        <KnowledgeModule />
      </>,
    );

    expect(renderedRadiusViolations(html)).toEqual([]);
  });
});
