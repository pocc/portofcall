export type ProtocolStatus = 'active' | 'deprecated' | 'niche';
export type PopularityTier = 'ubiquitous' | 'common' | 'moderate' | 'rare' | 'niche';
export type ProtocolCategory = 'databases' | 'messaging' | 'email' | 'remote' | 'files' | 'web' | 'network' | 'specialty';

export interface Protocol {
  id: string;
  name: string;
  description: string;
  port: number;
  icon: string;
  features: string[];
  status: ProtocolStatus;
  popularity: PopularityTier;
  category: ProtocolCategory;
  year: number;
  rfc?: string;
  lastUpdated?: number;
  implementations?: { name: string; url: string }[];
}

export interface RFCEntry {
  name: string;
  icon: string;
  rfc: string | null;
  year: number;
  description: string;
  workersCompatible: boolean;
  reason?: string;
  layer: 'L2' | 'L3' | 'L4/L7' | 'Application';
}

export type SortOption = 'popularity' | 'year-asc' | 'year-desc' | 'port-asc' | 'port-desc';
