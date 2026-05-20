import { readFileSync } from "fs"
import { join } from "path"
import { marked } from "marked"

export default async function AdminManualPage() {
  const md   = readFileSync(join(process.cwd(), "content/manual-admin.md"), "utf-8")
  const html = await marked(md)

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto">
      <article
        className="prose prose-sm lg:prose-base prose-gray max-w-none
          prose-headings:font-semibold prose-h1:text-xl prose-h2:text-base prose-h2:mt-8
          prose-table:text-xs prose-td:py-1.5 prose-th:py-1.5
          prose-blockquote:text-sm prose-blockquote:not-italic
          prose-pre:bg-gray-100 prose-pre:text-xs"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
