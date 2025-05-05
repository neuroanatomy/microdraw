window.ToolDivideRegion = {
    divideRegion: (() => {
        let tempPath = null
        let isDragging = false

        function insertPathToMicrodraw(_path, name, originalInsert){
            const path = new paper.Path()
            path.importJSON(
                _path.exportJSON()
            )
            path.insert = originalInsert

            path.closed = true
            const { red, green, blue } = Microdraw.regionHashColor(name)
            path.fillColor = `rgba(${red}, ${green}, ${blue}, 0.5)`
            
            Microdraw.newRegion({
                name,
                path
            })
        }

        function canFinalize(){
            if (tempPath === null) {
                return false
            }
            
            const originalPath = Microdraw.region.path
            const pathToBisect = originalPath.clone({ insert: false })
            const interceptor = tempPath.clone({ insert: false })

            const intersections = pathToBisect.getIntersections(interceptor)
            const { insert: _originalInsert } = pathToBisect
            return intersections.length === 2
        }

        function finalize() {
            function cleanup(){
                tempPath.remove()
                tempPath = null
            }
            if (tempPath === null) {
                return
            }
            

            const originalPath = Microdraw.region.path
            const originalName = Microdraw.region.name
            const pathToBisect = originalPath.clone({ insert: false })
            const interceptor = tempPath.clone({ insert: false })

            const intersections = pathToBisect.getIntersections(interceptor)
            const { insert: _originalInsert } = pathToBisect

            if (intersections.length !== 2) {
                console.warn(`Can only deal with exactly two intersections.`)
                cleanup()
                return
            }

            const newPaths = new Set([pathToBisect])
            const segmentedInterceptor = new Set([interceptor])


            for (const intersection of intersections){
                const newPath = pathToBisect.splitAt(intersection)
                newPaths.add(newPath)

                for (const segment of Array.from(segmentedInterceptor)){

                    const offset = segment.getOffsetOf(intersection.point)
                    const pathLocation = segment.getLocationAt(offset)
                    if (pathLocation) {
                        const newSegment = segment.splitAt(pathLocation)
                        if (newSegment) segmentedInterceptor.add(newSegment)
                    }
                }
            }

            const innerSegments = Array.from(segmentedInterceptor).filter(segment => {
                const centerPt = segment.length > 3
                ? segment.getPointAt(Math.floor( segment.length / 2 ))
                : segment.bounds.center
                return originalPath.contains(centerPt)
            })

            if (innerSegments.length !== 1) {
                console.warn(`Can only work with line segmenting area from inside`)
                cleanup()
                return
            }

            const innerSegment = innerSegments[0]

            const newPathsArr = Array.from(newPaths)
            for (const newPathIdx in newPathsArr){
                const newPath = newPathsArr[newPathIdx]
                const tobeJoined = innerSegment.clone({insert: false})

                // check if the segment to be added is reversed.
                // If reversed, reverse, then join
                const srcFirst = newPath.segments[0].point
                const srcLast = newPath.segments[newPath.segments.length - 1].point
                const addFirst = tobeJoined.segments[0].point
                const reversed = srcFirst.getDistance(addFirst) < srcLast.getDistance(addFirst)
                if (reversed) {
                    tobeJoined.reverse()
                }
                
                newPath.join(tobeJoined)
                insertPathToMicrodraw(newPath, `${originalName} - ${newPathIdx}`, _originalInsert)
            }
            cleanup()
            Microdraw.commitMouseUndo()
        }
        return {
            // see https://stackoverflow.com/questions/23258001/slice-path-into-two-separate-paths-using-paper-js
            mouseDown(point) {
                if (tempPath === null) {
                    tempPath = new paper.Path({segments:[point]})

                    tempPath.strokeWidth = Microdraw.config.defaultStrokeWidth
                    tempPath.strokeScaling = false
                    tempPath.strokeColor = new paper.Color(0.5, 0, 0)
                    paper.view.draw()
                    return
                }
                // allow define line by click-click-click
                if (!isDragging) {
                    tempPath.add(point)
                    paper.view.draw()
                    
                    if (canFinalize()) {
                        finalize()
                    }
                    return
                }
            },
            mouseDrag(point,dpoint){
                // allow define line by mousedown-drag-mouseup
                if (!tempPath) {
                    return
                }
                tempPath.add(point)
                paper.view.draw()
                isDragging = true
            },
            mouseUp(){
                if (isDragging) {
                    finalize()
                    isDragging = false
                    return
                }

            },
            click(prevTool){
                if (!Microdraw.region) {
                    Microdraw.backToPreviousTool(prevTool);
                    return
                }
                Microdraw.navEnabled = false;
            },
            onDeselect(newTool){
                
            }
        }
    })()
}