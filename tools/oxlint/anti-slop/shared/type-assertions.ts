import type { ESTree } from "@oxlint/plugins";

export type TypeAssertionExpression = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

/** Identify TypeScript's special `as const` assertion. */
export function isConstAssertion(node: TypeAssertionExpression): boolean {
	const { typeAnnotation } = node;
	return (
		typeAnnotation.type === "TSTypeReference" &&
		typeAnnotation.typeName.type === "Identifier" &&
		typeAnnotation.typeName.name === "const"
	);
}
