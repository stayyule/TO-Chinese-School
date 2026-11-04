import { useQuery } from '@tanstack/react-query'
import { apiJson } from '../../api/client'

export const SCHOOL_CLASS_TYPES = ['S', 'T', 'M', 'SE', 'ELECTIVE', 'EC', 'ECPS'] as const

export interface SchoolClass {
  id: number
  englishName: string | null
  chineseName: string | null
  shortName: string | null
  description: string | null
  location: string | null
  schoolClassType: string | null
  maxSize: number | null
  minAge: number | null
  maxAge: number | null
  gradeId: number | null
  activeCurrent: boolean
  activeNext: boolean
}

export interface Grade {
  id: number
  englishName: string | null
  chineseName: string | null
  shortName: string | null
}

export const CLASSES_KEY = ['school-classes'] as const

export function useSchoolClasses() {
  return useQuery({ queryKey: CLASSES_KEY, queryFn: () => apiJson<SchoolClass[]>('/school-classes') })
}

export function useGrades(enabled: boolean) {
  return useQuery({ queryKey: ['grades'], queryFn: () => apiJson<Grade[]>('/grades'), enabled })
}
