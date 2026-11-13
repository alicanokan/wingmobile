// Feathers curated from two public datasets (see public/feathers/dataset/LICENSE.md).
// Each was cut out of its photograph, stood upright and saved on black/transparent
// in the same format as the built-in collection (900 px tall + 150 px thumbnail).
// Regenerate with scripts/feather-datasets/ — then update this list to match.
//
// FeathersV1 and the Kaggle set are licensed for NON-COMMERCIAL use only; the
// Feather Atlas (USFWS) is free to use. Keep the credits for all three.

import type { FeatherItem } from './feathers.ts';

export type DatasetSourceId = 'feathersv1' | 'kaggle-lasota' | 'feather-atlas';

export interface DatasetSource {
  id: DatasetSourceId;
  name: string;
  /** Who to credit, in the form the licence asks for. */
  credit: string;
  licence: string;
  /** Two or three words for picker headings: what the licence lets us do. */
  usage: string;
  url: string;
}

export const DATASET_SOURCES: Record<DatasetSourceId, DatasetSource> = {
  feathersv1: {
    id: 'feathersv1',
    name: 'FeathersV1 Dataset',
    credit: 'A.V. Belko, K.S. Dobratulin. FeathersV1 dataset for feathers classification.',
    licence: 'FeathersV1 licence — non-commercial use only; images remain the property of their original owners',
    usage: 'Non-commercial use',
    url: 'https://github.com/feathers-dataset/feathersv1-dataset',
  },
  'kaggle-lasota': {
    id: 'kaggle-lasota',
    name: 'Feather Dataset (Kaggle)',
    credit: 'Mirek Lasota and Arda Mavi (2024). Feather Dataset. Kaggle. https://doi.org/10.34740/KAGGLE/DSV/8843733',
    licence: 'CC BY-NC-SA 4.0',
    usage: 'Non-commercial use',
    url: 'https://www.kaggle.com/datasets/ardamavi/feather-dataset',
  },
  'feather-atlas': {
    id: 'feather-atlas',
    name: 'The Feather Atlas (USFWS)',
    credit: 'The Feather Atlas, U.S. Fish & Wildlife Service Forensics Laboratory.',
    licence: 'Free to use — "no special permission is required" (U.S. federal work)',
    usage: 'Free to use',
    url: 'https://www.fws.gov/lab/featheratlas/',
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
  { id: 'ds-american-kestrel', src: '/feathers/dataset/american-kestrel.png', label: 'American kestrel · tail', species: 'Falco sparverius', dataset: 'feather-atlas', original: 'AMKE_tail_male.jpg' },
  { id: 'ds-bald-eagle', src: '/feathers/dataset/bald-eagle.png', label: 'Bald eagle · tail', species: 'Haliaeetus leucocephalus', dataset: 'feather-atlas', original: 'BAEA_tail_adult.jpg' },
  { id: 'ds-barred-owl', src: '/feathers/dataset/barred-owl.png', label: 'Barred owl · tail', species: 'Strix varia', dataset: 'feather-atlas', original: 'BDOW_tail_adult.jpg' },
  { id: 'ds-blue-jay', src: '/feathers/dataset/blue-jay.png', label: 'Blue jay · tail', species: 'Cyanocitta cristata', dataset: 'feather-atlas', original: 'BLJA_tail_adult.jpg' },
  { id: 'ds-cedar-waxwing', src: '/feathers/dataset/cedar-waxwing.png', label: 'Cedar waxwing · tail', species: 'Bombycilla cedrorum', dataset: 'feather-atlas', original: 'CEDW_tail_adult.jpg' },
  { id: 'ds-common-raven', src: '/feathers/dataset/common-raven.png', label: 'Common raven · tail', species: 'Corvus corax', dataset: 'feather-atlas', original: 'CORA_tail_male_new.jpg' },
  { id: 'ds-eastern-bluebird', src: '/feathers/dataset/eastern-bluebird.png', label: 'Eastern bluebird · tail', species: 'Sialia sialis', dataset: 'feather-atlas', original: 'EABL_tail_male.jpg' },
  { id: 'ds-great-horned-owl', src: '/feathers/dataset/great-horned-owl.png', label: 'Great horned owl · primary', species: 'Bubo virginianus', dataset: 'feather-atlas', original: 'GHOW_primary.jpg' },
  { id: 'ds-golden-eagle', src: '/feathers/dataset/golden-eagle.png', label: 'Golden eagle · tail', species: 'Aquila chrysaetos', dataset: 'feather-atlas', original: 'GOEA_tail_gwenie.jpg' },
  { id: 'ds-monk-parakeet', src: '/feathers/dataset/monk-parakeet.png', label: 'Monk parakeet · tail', species: 'Myiopsitta monachus', dataset: 'feather-atlas', original: 'MOPA_tail_male.jpg' },
  { id: 'ds-northern-harrier', src: '/feathers/dataset/northern-harrier.png', label: 'Northern harrier · tail', species: 'Circus hudsonius', dataset: 'feather-atlas', original: 'NOHA_tail_male.jpg' },
  { id: 'ds-peregrine-falcon', src: '/feathers/dataset/peregrine-falcon.png', label: 'Peregrine falcon · tail', species: 'Falco peregrinus', dataset: 'feather-atlas', original: 'PEFA_tail_adult.jpg' },
  { id: 'ds-roseate-spoonbill', src: '/feathers/dataset/roseate-spoonbill.png', label: 'Roseate spoonbill · tail', species: 'Platalea ajaja', dataset: 'feather-atlas', original: 'ROSP_tail_male.jpg' },
  { id: 'ds-red-shafted-flicker', src: '/feathers/dataset/red-shafted-flicker.png', label: 'Northern flicker (red-shafted) · tail', species: 'Colaptes auratus', dataset: 'feather-atlas', original: 'RSFL_tail_adult_ventral.jpg' },
  { id: 'ds-red-tailed-hawk', src: '/feathers/dataset/red-tailed-hawk.png', label: 'Red-tailed hawk · tail', species: 'Buteo jamaicensis', dataset: 'feather-atlas', original: 'RTHA_tail_adult.jpg' },
  { id: 'ds-snowy-owl', src: '/feathers/dataset/snowy-owl.png', label: 'Snowy owl · primary', species: 'Bubo scandiacus', dataset: 'feather-atlas', original: 'SNOW_primary_adult.jpg' },
  { id: 'ds-stellers-jay', src: '/feathers/dataset/stellers-jay.png', label: "Steller's jay · tail", species: 'Cyanocitta stelleri', dataset: 'feather-atlas', original: 'STJA_tail_female.jpg' },
  { id: 'ds-wild-turkey', src: '/feathers/dataset/wild-turkey.png', label: 'Wild turkey · tail', species: 'Meleagris gallopavo', dataset: 'feather-atlas', original: 'WITU_tail_fmle.jpg' },
  { id: 'ds-wood-duck', src: '/feathers/dataset/wood-duck.png', label: 'Wood duck · tail', species: 'Aix sponsa', dataset: 'feather-atlas', original: 'WODU_tail_male.jpg' },
  { id: 'ds-black-billed-magpie', src: '/feathers/dataset/black-billed-magpie.png', label: 'Black-billed magpie · tail', species: 'Pica hudsonia', dataset: 'feather-atlas', original: 'BBMA_tail_adult.jpg' },
];
