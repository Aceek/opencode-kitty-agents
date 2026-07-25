export type ChildSessionStatus = "idle" | "busy" | "retry"

/** A project-scoped OpenCode child session normalized for presentation policy. */
export type ChildSession = Readonly<{
  id: string
  parentID: string
  directory: string
  title: string
  status: ChildSessionStatus
}>
