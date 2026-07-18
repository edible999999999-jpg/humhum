// @vitest-environment happy-dom

import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import postcss, { type Root, type Rule } from "postcss";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { HumiModule } from "./HumiModule";
import { KnowledgeModule } from "./KnowledgeModule";

const hubSourceDirectory = resolve(process.cwd(), "src/components/Hub");
const modulePaths = [
  resolve(process.cwd(), "src/components/Hub/HumiModule.tsx"),
  resolve(process.cwd(), "src/components/Hub/KnowledgeModule.tsx"),
];
const globalStyleRoot = postcss.parse(
  readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8"),
);
const characterRoomStyleRoot = postcss.parse(
  readFileSync(
    resolve(process.cwd(), "src/styles/hub-character-rooms.css"),
    "utf8",
  ),
);

function componentSourcePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return componentSourcePaths(path);
    if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) return [];
    return [path];
  });
}

function usedHubKawaiiClasses(): string[] {
  const classes = componentSourcePaths(hubSourceDirectory).flatMap((path) =>
    Array.from(
      readFileSync(path, "utf8").matchAll(/\bkawaii-[a-z0-9-]+\b/g),
      (match) => match[0],
    ),
  );

  return Array.from(new Set(classes)).sort();
}

function selectorRule(root: Root, selector: string): Rule | undefined {
  let match: Rule | undefined;
  root.walkRules((rule) => {
    if (!match && rule.selectors.includes(selector)) match = rule;
  });
  return match;
}

function declaration(rule: Rule | undefined, property: string): string | undefined {
  let value: string | undefined;
  rule?.walkDecls(property, (node) => {
    value ??= node.value;
  });
  return value;
}

function isExplicitCssCircle(rule: Rule, radius: string): boolean {
  const numericRadius = Number.parseFloat(radius);
  if (radius !== "50%" && numericRadius < 999) return false;

  const width = declaration(rule, "width");
  const height = declaration(rule, "height");
  return width !== undefined && width === height && /^\d+(?:\.\d+)?px$/.test(width);
}

function classRadiusViolations(): string[] {
  return usedHubKawaiiClasses().flatMap((className) => {
    const baseRule = selectorRule(globalStyleRoot, `.${className}`);
    const baseRadius = declaration(baseRule, "border-radius");
    const numericBaseRadius = Number.parseFloat(baseRadius ?? "");

    if (
      !baseRule ||
      !Number.isFinite(numericBaseRadius) ||
      numericBaseRadius <= 8 ||
      isExplicitCssCircle(baseRule, baseRadius ?? "")
    ) {
      return [];
    }

    const scopedSelector = `.hub-room .${className}`;
    const scopedRadius = declaration(
      selectorRule(characterRoomStyleRoot, scopedSelector),
      "border-radius",
    );
    const numericScopedRadius = Number.parseFloat(scopedRadius ?? "");

    return Number.isFinite(numericScopedRadius) && numericScopedRadius <= 8
      ? []
      : [`${className}: ${baseRadius} -> ${scopedRadius ?? "missing"}`];
  });
}

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

describe("Hub class radius contract", () => {
  it("scopes every used non-circular kawaii class radius to 8px or less", () => {
    expect(classRadiusViolations()).toEqual([]);
  });
});
