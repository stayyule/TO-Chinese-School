import { useQuery } from '@tanstack/react-query'
import { apiJson } from '../../api/client'

export interface PersonView {
  id: number
  englishFirstName: string | null
  englishLastName: string | null
  chineseName: string | null
  gender: string | null
  birthYear: number | null
  birthMonth: number | null
  nativeLanguage: string | null
}

export interface AddressView {
  id: number
  street: string | null
  city: string | null
  state: string | null
  zipcode: string | null
  homePhone: string | null
  cellPhone: string | null
  email: string | null
}

export interface FamilyView {
  id: number
  parentOne: PersonView | null
  parentTwo: PersonView | null
  children: PersonView[]
  address: AddressView | null
}

export const FAMILIES_KEY = ['me', 'families'] as const

export function useFamilies() {
  return useQuery({ queryKey: FAMILIES_KEY, queryFn: () => apiJson<FamilyView[]>('/me/families') })
}

export function personName(p: PersonView): string {
  return [p.englishFirstName, p.englishLastName].filter(Boolean).join(' ')
}
