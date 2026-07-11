// Deterministic mock-data generator. In a real Applied Epic deployment this stage
// would talk to the Applied Dev Center REST APIs (clients/policies endpoints) or
// Epic's import utilities to hydrate a test database; here it posts the same
// shaped data to the target's seed API.

const DAY = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

export function standardBook() {
  return {
    dataset: 'standard-book',
    clients: [
      {
        name: 'Lakeside Manufacturing Co',
        type: 'Commercial',
        contactName: 'Priya Natarajan',
        email: 'priya@lakesidemfg.com',
        phone: '312-555-0141',
        policies: [
          {
            lineOfBusiness: 'General Liability',
            carrier: 'Hartline Mutual',
            premium: 12400,
            effectiveDate: daysFromNow(-300),
            billingMode: 'Agency Bill',
            invoice: true,
          },
          {
            lineOfBusiness: 'Workers Compensation',
            carrier: 'Pacific Standard',
            premium: 8750,
            effectiveDate: daysFromNow(-300),
            billingMode: 'Direct Bill',
            invoice: false,
          },
        ],
      },
      {
        name: 'Harbor Point Logistics',
        type: 'Commercial',
        contactName: 'Marcus Cole',
        email: 'mcole@harborpoint.io',
        phone: '206-555-0187',
        policies: [
          {
            lineOfBusiness: 'Commercial Auto',
            carrier: 'Crestview Insurance',
            premium: 21900,
            effectiveDate: daysFromNow(-330),
            billingMode: 'Agency Bill',
            invoice: true,
          },
        ],
      },
      {
        name: 'Bluebird Cafe Group',
        type: 'Commercial',
        contactName: 'Elena Ruiz',
        email: 'elena@bluebirdcafe.com',
        phone: '415-555-0122',
        policies: [
          {
            lineOfBusiness: 'Property',
            carrier: 'Ironbridge Specialty',
            premium: 6400,
            effectiveDate: daysFromNow(-45),
            billingMode: 'Agency Bill',
            invoice: true,
          },
        ],
      },
      {
        name: 'Sandra Whitfield',
        type: 'Personal',
        contactName: 'Sandra Whitfield',
        email: 'sandra.w@gmail.com',
        phone: '773-555-0165',
        policies: [
          {
            lineOfBusiness: 'Umbrella',
            carrier: 'Hartline Mutual',
            premium: 980,
            effectiveDate: daysFromNow(-200),
            billingMode: 'Direct Bill',
            invoice: false,
          },
        ],
      },
      {
        name: 'Northgate Dental Partners',
        type: 'Commercial',
        contactName: 'Dr. James Okafor',
        email: 'admin@northgatedental.com',
        phone: '847-555-0198',
        policies: [],
      },
    ],
  };
}

export async function seedTarget(baseUrl: string, endpoint: string): Promise<unknown> {
  const payload = standardBook();
  const res = await fetch(baseUrl + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Seed failed: ${res.status} ${await res.text()}`);
  return res.json();
}
