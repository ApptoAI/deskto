import {
  isPageLikeArtifactPreviewKind,
  type ArtifactPreviewKind,
} from "@deskto/protocol"

/** Conversation links use Browser for page-like outputs and Files for the rest. */
export function defaultArtifactOpenSurface(
  kind: ArtifactPreviewKind
): "browser" | "files" {
  return isPageLikeArtifactPreviewKind(kind) ? "browser" : "files"
}
