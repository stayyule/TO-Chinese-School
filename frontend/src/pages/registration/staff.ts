import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '../../api/client'
import type { AddressView, FamilyView, PersonView } from '../parent/families'

export interface PersonDetail extends PersonView {
  address: AddressView | null
  families: FamilyView[]
}

export interface PeoplePage {
  items: PersonView[]
  total: number
}

export const PEOPLE_PAGE_SIZE = 25

export const personKey = (id: number) => ['staff', 'person', id] as const
export const familyKey = (id: number) => ['staff', 'family', id] as const

export function usePeople(query: string, page: number) {
  return useQuery({
    queryKey: ['staff', 'people', query, page, PEOPLE_PAGE_SIZE],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PEOPLE_PAGE_SIZE) })
      if (query !== '') params.set('query', query)
      return apiJson<PeoplePage>(`/people?${params.toString()}`)
    },
    placeholderData: (previous) => previous,
  })
}

export function usePerson(id: number) {
  return useQuery({ queryKey: personKey(id), queryFn: () => apiJson<PersonDetail>(`/people/${id}`) })
}

export function useFamily(id: number) {
  return useQuery({ queryKey: familyKey(id), queryFn: () => apiJson<FamilyView>(`/families/${id}`) })
}

/** Refreshes every cached staff people/family query after a change. */
export function useRefreshStaff() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['staff'] })
}
