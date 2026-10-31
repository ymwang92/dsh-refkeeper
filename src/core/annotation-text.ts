/**
 * Reject model text that talks about the evidence instead of the work.
 *
 * Asked for "why this work is cited", a model with a thin excerpt tends to
 * answer meta-questions: "the excerpt does not mention this reference", "no
 * citation sentence is available", "cannot be determined from the given text".
 * Those sentences say nothing about the reference, and in BibTeX `note`, RIS
 * `N1` or `annotated.md` they read as if the library believed them. A field
 * that is absent is honest; a field that explains its own absence is noise.
 *
 * The check is deliberately blunt: any sentence about "the excerpt", "the
 * context" or "the given text" is commentary, because a real annotation talks
 * about the paper, not about the material the annotator was handed.
 */
const META_COMMENTARY: readonly RegExp[] = [
  // "the excerpt", "the supplied text", "the given context", "runtime and workspace context"
  /\b(?:the|this|that|supplied|given|provided|available|above|conversation)\s+(?:excerpt|text|context|passage|snippet|transcript)\b/iu,
  /\bruntime and workspace context\b/iu,
  // "does not mention/cite/state/say/contain/include/provide"
  /\b(?:does|do|did)\s+not\s+(?:mention|cite|state|say|contain|include|provide|describe|specify|refer)\b/iu,
  /\bno\s+(?:citation|reference|mention)\s+(?:sentence|statement|is|was)\b/iu,
  /\b(?:cannot|can\s+not|can't)\s+be\s+(?:determined|inferred|established|known)\b/iu,
  /\b(?:no|without)\s+(?:statement|indication|evidence)\s+(?:of|that|why)\b/iu,
  /\bnot\s+(?:available|present|provided)\s+in\s+(?:the|this)\b/iu,
  /\bno\s+(?:relevant\s+)?(?:information|details|content|context)\s+(?:is|was|are|were)\s+(?:available|provided|given)\b/iu,
  /\bnothing\s+in\s+(?:the|this)\s+(?:excerpt|context|passage|text)\b/iu,
  /\bthe\s+(?:excerpt|context|passage)\s+(?:is|only|consists|contains)\b/iu,
  // Chinese equivalents: 摘录/片段/上下文 中 未提及 / 无法确定 / 没有出处
  /(?:摘录|片段|上下文|原文|对话内容)/u,
  /未(?:提及|提到|说明|提供|包含|涉及)/u,
  /(?:无法|不能)(?:确定|判断|推断|得知)/u,
  /(?:没有|无)(?:可用的)?\s*(?:引用|出处|依据|相关信息|相关内容)/u,
]

/** Annotation text with meta-commentary removed; empty string means "leave the field out". */
export function usefulAnnotationText(value: string | undefined): string {
  const text = (value ?? '').trim()
  if (text === '') return ''
  return META_COMMENTARY.some((pattern) => pattern.test(text)) ? '' : text
}
