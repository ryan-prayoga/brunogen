<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\ResourceCollection;

class ProjectPreFilteredCollection extends ResourceCollection
{
    public $collects = ProjectResource::class;

    public function toArray(Request $request): array
    {
        return [
            'prefiltered' => $this->collection
                ->filter(function (array $project) use ($request) {
                    return $project['owner_email'];
                })
                ->map(function (array $project, int $index) {
                    return [
                        'position' => $index,
                        'identifier' => $project['id'],
                        'owner' => $project['owner_email'],
                        'label' => 'prefiltered-project',
                    ];
                })
                ->values()
                ->all(),
        ];
    }
}
