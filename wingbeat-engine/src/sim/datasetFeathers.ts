// Feathers curated from two public datasets (see public/feathers/dataset/LICENSE.md).
// Each was cut out of its photograph, stood upright and saved on black/transparent
// in the same format as the built-in collection (900 px tall + 150 px thumbnail).
// Regenerate with scripts/feather-datasets/ — then update this list to match.
//
// Both sources are licensed for NON-COMMERCIAL use only; keep the credits.

import type { FeatherItem } from './feathers.ts';

export type DatasetSourceId = 'feathersv1' | 'kaggle-lasota';

export interface DatasetSource {
  id: DatasetSourceId;
  name: string;
  /** Who to credit, in the form the licence asks for. */
  credit: string;
  licence: string;
  url: string;
}

export const DATASET_SOURCES: Record<DatasetSourceId, DatasetSource> = {
  feathersv1: {
    id: 'feathersv1',
    name: 'FeathersV1 Dataset',
    credit: 'A.V. Belko, K.S. Dobratulin. FeathersV1 dataset for feathers classification.',
    licence: 'FeathersV1 licence — non-commercial use only; images remain the property of their original owners',
    url: 'https://github.com/feathers-dataset/feathersv1-dataset',
  },
  'kaggle-lasota': {
    id: 'kaggle-lasota',
    name: 'Feather Dataset (Kaggle)',
    credit: 'Mirek Lasota and Arda Mavi (2024). Feather Dataset. Kaggle. https://doi.org/10.34740/KAGGLE/DSV/8843733',
    licence: 'CC BY-NC-SA 4.0',
    url: 'https://www.kaggle.com/datasets/ardamavi/feather-dataset',
  },
};

export interface DatasetFeather extends FeatherItem {
  dataset: DatasetSourceId;
  /** Scientific name, as labelled by the dataset (or read from the specimen note). */
  species: string;
  /** Source file inside the dataset, so the image can be traced back. */
  original: string;
}

export const DATASET_FEATHERS: DatasetFeather[] = [
  { id: 'ds-eurasian-sparrowhawk', src: '/feathers/dataset/eurasian-sparrowhawk.png', label: 'Eurasian sparrowhawk', species: 'Accipiter nisus', dataset: 'feathersv1', original: 'accipitriformes_accipiter_nisus_00155.jpg' },
  { id: 'ds-european-nightjar', src: '/feathers/dataset/european-nightjar.png', label: 'European nightjar', species: 'Caprimulgus europaeus', dataset: 'feathersv1', original: 'caprimulgiformes_caprimulgus_europaeus_00024.jpg' },
  { id: 'ds-oystercatcher', src: '/feathers/dataset/oystercatcher.png', label: 'Eurasian oystercatcher', species: 'Haematopus ostralegus', dataset: 'feathersv1', original: 'charadriiformes_haematopus_ostralegus_00233.jpg' },
  { id: 'ds-kingfisher', src: '/feathers/dataset/kingfisher.png', label: 'Common kingfisher', species: 'Alcedo atthis', dataset: 'feathersv1', original: 'coraciiformes_alcedo_atthis_00036.jpg' },
  { id: 'ds-blue-bellied-roller', src: '/feathers/dataset/blue-bellied-roller.png', label: 'Blue-bellied roller', species: 'Coracias cyanogaster', dataset: 'feathersv1', original: 'coraciiformes_coracias_cyanogaster_00000.jpg' },
  { id: 'ds-common-pheasant', src: '/feathers/dataset/common-pheasant.png', label: 'Common pheasant', species: 'Phasianus colchicus', dataset: 'feathersv1', original: 'galliformes_phasianus_colchicus_00059.jpg' },
  { id: 'ds-capercaillie', src: '/feathers/dataset/capercaillie.png', label: 'Western capercaillie', species: 'Tetrao urogallus', dataset: 'feathersv1', original: 'galliformes_tetrao_urogallus_00000.jpg' },
  { id: 'ds-eurasian-jay', src: '/feathers/dataset/eurasian-jay.png', label: 'Eurasian jay', species: 'Garrulus glandarius', dataset: 'feathersv1', original: 'passeriformes_garrulus_glandarius_00112.jpg' },
  { id: 'ds-golden-oriole', src: '/feathers/dataset/golden-oriole.png', label: 'Eurasian golden oriole', species: 'Oriolus oriolus', dataset: 'feathersv1', original: 'passeriformes_oriolus_oriolus_00000.jpg' },
  { id: 'ds-greater-flamingo', src: '/feathers/dataset/greater-flamingo.png', label: 'Greater flamingo', species: 'Phoenicopterus roseus', dataset: 'feathersv1', original: 'phoenicopteriformes_phoenicopterus_roseus_00021.jpg' },
  { id: 'ds-great-spotted-woodpecker', src: '/feathers/dataset/great-spotted-woodpecker.png', label: 'Great spotted woodpecker', species: 'Dendrocopos major', dataset: 'feathersv1', original: 'piciformes_dendrocopos_major_00050.jpg' },
  { id: 'ds-green-woodpecker', src: '/feathers/dataset/green-woodpecker.png', label: 'European green woodpecker', species: 'Picus viridis', dataset: 'feathersv1', original: 'piciformes_picus_viridis_00000.jpg' },
  { id: 'ds-yellow-crowned-amazon', src: '/feathers/dataset/yellow-crowned-amazon.png', label: 'Yellow-crowned amazon', species: 'Amazona ochrocephala', dataset: 'feathersv1', original: 'psittaciformes_amazona_ochrocephala_00025.jpg' },
  { id: 'ds-turquoise-parrot', src: '/feathers/dataset/turquoise-parrot.png', label: 'Turquoise parrot', species: 'Neophema pulchella', dataset: 'feathersv1', original: 'psittaciformes_neophema_pulchella_00024.jpg' },
  { id: 'ds-long-eared-owl', src: '/feathers/dataset/long-eared-owl.png', label: 'Long-eared owl', species: 'Asio otus', dataset: 'feathersv1', original: 'strigiformes_asio_otus_00078.jpg' },
  { id: 'ds-eurasian-eagle-owl', src: '/feathers/dataset/eurasian-eagle-owl.png', label: 'Eurasian eagle-owl', species: 'Bubo bubo', dataset: 'feathersv1', original: 'strigiformes_bubo_bubo_00023.jpg' },
  { id: 'ds-barn-owl', src: '/feathers/dataset/barn-owl.png', label: 'Barn owl', species: 'Tyto alba', dataset: 'feathersv1', original: 'strigiformes_tyto_alba_00081.jpg' },
  { id: 'ds-cuban-trogon', src: '/feathers/dataset/cuban-trogon.png', label: 'Cuban trogon', species: 'Priotelus temnurus', dataset: 'feathersv1', original: 'trogoniformes_priotelus_temnurus_00016.jpg' },
  { id: 'ds-green-winged-macaw', src: '/feathers/dataset/green-winged-macaw.png', label: 'Green-winged macaw', species: 'Ara chloropterus', dataset: 'kaggle-lasota', original: 'processed-966B1B1B-7A97-4119-BD8A-78870DF1530F.jpeg' },
  { id: 'ds-scarlet-chested-parrot', src: '/feathers/dataset/scarlet-chested-parrot.png', label: 'Scarlet-chested parrot', species: 'Neophema splendida', dataset: 'kaggle-lasota', original: 'processed-69D87813-78AD-4497-A7D2-587C105E0BB5.jpeg' },
  { id: 'ds-black-woodpecker', src: '/feathers/dataset/black-woodpecker.png', label: 'Black woodpecker', species: 'Dryocopus martius', dataset: 'kaggle-lasota', original: 'processed-49E3208A-DBCD-4B7C-97C2-9B3FFCEC29D8.jpeg' },
  { id: 'ds-eurasian-curlew', src: '/feathers/dataset/eurasian-curlew.png', label: 'Eurasian curlew', species: 'Numenius arquata', dataset: 'kaggle-lasota', original: 'processed-B1AB31D5-2067-4CE3-9A2F-0C3A59A57561.jpeg' },
];
