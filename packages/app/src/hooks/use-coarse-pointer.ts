import * as React from "react"

export function useIsCoarsePointer() {
  const [isCoarse, setIsCoarse] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)")
    const onChange = () => {
      setIsCoarse(mql.matches)
    }
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isCoarse
}
