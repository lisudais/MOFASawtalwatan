import type { HealthSnapshot } from '../types';

const ALL_URL = 'https://disease.sh/v3/covid-19/all';
const COUNTRIES_URL = 'https://disease.sh/v3/covid-19/countries?sort=cases';

export async function fetchHealthSnapshot(): Promise<HealthSnapshot | null> {
  try {
    const [allRes, countriesRes] = await Promise.all([
      fetch(ALL_URL, { signal: AbortSignal.timeout(8000) }),
      fetch(COUNTRIES_URL, { signal: AbortSignal.timeout(8000) }),
    ]);
    const all = await allRes.json();
    const countries = await countriesRes.json();

    return {
      activeCases: all.active,
      todayCases: all.todayCases,
      deaths: all.deaths,
      todayDeaths: all.todayDeaths,
      affectedCountries: all.affectedCountries,
      updatedAt: new Date(all.updated),
      topCountries: (countries as any[]).slice(0, 5).map((c) => ({
        country: c.country,
        countryCode: c.countryInfo?.iso2 ?? '',
        cases: c.cases,
        todayCases: c.todayCases,
      })),
    };
  } catch {
    return null;
  }
}
