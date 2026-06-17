/**
 * Plan block sub-dispatcher. Keeps the rich plan blocks (Diff, FileTree,
 * DataModel, ApiEndpoint, AnnotatedCode) out of the main ComponentRenderer
 * switch — that switch gains one delegating branch instead of five cases.
 */
import type { DialogComponent } from '../types'
import { AnnotatedCodeBlock } from './annotated-code-block'
import { ApiEndpointBlock } from './api-endpoint-block'
import { DataModelBlock } from './data-model-block'
import { DiffBlock } from './diff-block'
import { FileTreeBlock } from './file-tree-block'

export type PlanBlockComponent = Extract<
  DialogComponent,
  { type: 'Diff' | 'FileTree' | 'DataModel' | 'ApiEndpoint' | 'AnnotatedCode' }
>

const PLAN_BLOCK_TYPES: ReadonlySet<string> = new Set(['Diff', 'FileTree', 'DataModel', 'ApiEndpoint', 'AnnotatedCode'])

export function isPlanBlock(component: DialogComponent): component is PlanBlockComponent {
  return PLAN_BLOCK_TYPES.has(component.type)
}

export function PlanBlock({ component }: { component: PlanBlockComponent }) {
  switch (component.type) {
    case 'Diff':
      return <DiffBlock content={component.content} filename={component.filename} />
    case 'FileTree':
      return <FileTreeBlock label={component.label} entries={component.entries} />
    case 'DataModel':
      return <DataModelBlock name={component.name} fields={component.fields} />
    case 'ApiEndpoint':
      return (
        <ApiEndpointBlock
          method={component.method}
          path={component.path}
          description={component.description}
          request={component.request}
          response={component.response}
        />
      )
    case 'AnnotatedCode':
      return (
        <AnnotatedCodeBlock
          code={component.code}
          language={component.language}
          filename={component.filename}
          annotations={component.annotations}
        />
      )
  }
}
