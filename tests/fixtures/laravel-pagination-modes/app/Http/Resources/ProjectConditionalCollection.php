<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\ResourceCollection;

class ProjectConditionalCollection extends ResourceCollection
{
    public $collects = ProjectResource::class;

    public function toArray(Request $request): array
    {
        $projects = collect($this->collection)
            ->when($request->boolean('compact'), function ($collection) {
                return $collection->values();
            })
            ->unless($request->boolean('skip_owner'), function ($collection) {
                return $collection->filter(function (array $project) {
                    return $project['owner_email'];
                });
            });

        return [
            'conditional' => $projects
                ->map(function (array $project, int $index) {
                    return [
                        'position' => $index,
                        'identifier' => $project['id'],
                        'owner' => $project['owner_email'],
                        'label' => 'conditional-project',
                    ];
                })
                ->values()
                ->all(),
        ];
    }
}
