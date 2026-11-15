/**
 * Public, host-independent API for consumers that need Refkeeper's pure
 * extraction, verification, and export logic.
 *
 * SourceId is currently a fixed union in `verify/types.ts`; reconsider its
 * boundaries when adding a new source registry.
 */
export * from './core/identifiers.ts'
export * from './core/citations.ts'
export * from './core/candidates.ts'
export * from './core/text.ts'
export * from './core/annotation-text.ts'
export * from './verify/match.ts'
export * from './verify/judge.ts'
export * from './verify/types.ts'
export * from './export/index.ts'

export { REF_TYPES } from './store/types.ts'
export type {
  QuarantineState,
  RefAuthor,
  RefType,
  StoreState,
  StoredReference,
} from './store/types.ts'
