<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\ResourceCollection;

class ProjectAssignedCollection extends ResourceCollection
{
    public $collects = ProjectResource::class;

    public function toArray(Request $request): array
    {
        $projects = collect($this->collection);

        return [
            'assigned' => $projects
                ->map(function (array $project, int $index) use ($request) {
                    return [
                        'position' => $index,
                        'identifier' => $project['id'],
                        'owner' => $project['owner_email'],
                        'label' => 'assigned-project',
                    ];
                })
                ->values()
                ->all(),
        ];
    }
}
