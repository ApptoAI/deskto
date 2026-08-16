import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const FORBIDDEN_SYMBOL_NAME = "shape";

function containsForbiddenSymbolWord(name: string): boolean {
  const words = name
    .replaceAll(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replaceAll(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[^A-Za-z]+/u);
  return words.some((word) => word.toLowerCase() === FORBIDDEN_SYMBOL_NAME);
}

function isRepositoryDeclaration(node: ESTree.Node & { name: string }): boolean {
  const parent = node.parent;
  switch (parent.type) {
    case "AccessorProperty":
    case "MethodDefinition":
    case "PropertyDefinition":
    case "TSMethodSignature":
    case "TSPropertySignature":
      return !parent.computed && parent.key === node;
    case "TSEnumMember":
      return parent.id === node;
    case "TSEnumDeclaration":
    case "TSImportEqualsDeclaration":
    case "TSInterfaceDeclaration":
    case "TSModuleDeclaration":
    case "TSTypeAliasDeclaration":
      return parent.id === node;
    case "TSMappedType":
      return parent.key === node;
    case "TSNamespaceExportDeclaration":
      return parent.id === node;
    case "TSTypeParameter":
      return parent.name === node;
    default:
      return false;
  }
}

function isExternalName(node: ESTree.Node & { name: string }): boolean {
  const parent = node.parent;
  return (
    parent.type === "ImportDefaultSpecifier" ||
    parent.type === "ImportNamespaceSpecifier" ||
    (parent.type === "ImportSpecifier" && parent.imported === node) ||
    (parent.type === "Property" && !parent.computed && parent.key === node)
  );
}

/** Ban the word "shape" in declarations owned by the repository. */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow the word "shape" in JavaScript and TypeScript declarations owned by the repository.',
    },
    messages: {
      forbiddenSymbolName:
        'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
    },
  },
  createOnce(context) {
    let declaredIdentifierOffsets = new Set<number>();

    const reportForbiddenSymbolName = (node: ESTree.Node & { name: string }) => {
      if (
        !containsForbiddenSymbolWord(node.name) ||
        isExternalName(node) ||
        (!declaredIdentifierOffsets.has(node.start) && !isRepositoryDeclaration(node))
      ) {
        return;
      }
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name: node.name },
      });
    };

    return {
      Program() {
        declaredIdentifierOffsets = new Set(
          context.sourceCode.scopeManager.scopes.flatMap((scope) =>
            scope.variables.flatMap((variable) =>
              variable.identifiers.map((identifier) => identifier.start),
            ),
          ),
        );
      },
      Identifier: reportForbiddenSymbolName,
      PrivateIdentifier: reportForbiddenSymbolName,
    };
  },
});
