import { RuleTester } from "oxlint/plugins-dev";

import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.ts";
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.ts";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";

const typescript = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

typescript.run("no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
	valid: [
		"const reshape = 1; const reshaped = reshape;",
		"const element = { shape: 1 }; element.shape;",
		'import { shape as renderMode } from "chart-library";',
		'import Shape from "chart-library";',
		'import * as Shape from "chart-library";',
		{
			filename: "component.tsx",
			code: "const View = () => <Widget shape='circle' />;",
		},
	],
	invalid: [
		{
			code: "const resultShape = 1;",
			errors: [{ messageId: "forbiddenSymbolName" }],
		},
		{
			code: 'import { shape } from "chart-library";',
			errors: [{ messageId: "forbiddenSymbolName" }],
		},
		{
			code: "const { shape } = source;",
			errors: [{ messageId: "forbiddenSymbolName" }],
		},
		{
			code: "interface RequestShape { renderShape: string }",
			errors: [{ messageId: "forbiddenSymbolName" }, { messageId: "forbiddenSymbolName" }],
		},
		{
			code: "class Store { #valueShape = 1 }",
			errors: [{ messageId: "forbiddenSymbolName" }],
		},
	],
});

typescript.run("no-widen-then-assert", noWidenThenAssertRule, {
	valid: [
		`type Record<K, V> = { value: V };
		 type Item = { id: string };
		 const wide: Record<string, unknown> = { value: { id: "one" } };
		 wide as { id: string };`,
		`type PropertyKey = "id";
		 type Item = { id: string };
		 const wide: Record<PropertyKey, unknown> = { id: "one" };
		 wide as { id: string };`,
		`type Readonly<T> = T;
		 type Item = { id: string };
		 const wide: Readonly<Record<string, unknown>> = { id: "one" };
		 wide as { id: string };`,
		`import type { Record } from "./types";
		 type Item = { id: string };
		 const wide: Record<string, unknown> = { id: "one" };
		 wide as { id: string };`,
	],
	invalid: [
		{
			code: `type Item = { id: string };
			 const wide: Record<string, unknown> = { id: "one" };
			 wide as { id: string };`,
			errors: [{ messageId: "widenThenAssert" }],
		},
		{
			code: `type Item = { id: string };
			 const wide: Readonly<Record<PropertyKey, unknown>> = { id: "one" };
			 wide as { id: string };`,
			errors: [{ messageId: "widenThenAssert" }],
		},
	],
});

typescript.run("no-runtime-typeof", noRuntimeTypeofRule, {
	valid: [
		{
			code: 'function isString(value: unknown): value is string { return typeof value === "string"; }',
			options: [{ allowInTypeGuards: true }],
		},
	],
	invalid: [
		{
			code: 'function isString(value: unknown): value is string { return typeof value === "string"; }',
			options: [{ allowInTypeGuards: false }],
			errors: [{ messageId: "runtimeTypeof" }],
		},
	],
});

typescript.run("no-unknown-returns", noUnknownReturnsRule, {
	valid: ["type Payload<T> = T; declare function load(): Payload<unknown>;"],
	invalid: [
		{
			code: "type Payload = unknown; declare function load(): Payload;",
			errors: [{ messageId: "unknownReturn" }],
		},
	],
});

typescript.run("no-unknown-type-aliases", noUnknownTypeAliasesRule, {
	valid: ["type Payload<T> = T;"],
	invalid: [
		{
			code: "type Payload = unknown; type Result = Payload;",
			errors: [{ messageId: "unknownAlias" }, { messageId: "unknownAlias" }],
		},
	],
});

typescript.run("no-object-parameters", noObjectParametersRule, {
	valid: ["type Input<T> = T; declare function run(value: Input<object>): void;"],
	invalid: [
		{
			code: "type Input = object; declare function run(value: Input): void;",
			errors: [{ messageId: "objectParameter" }],
		},
	],
});
